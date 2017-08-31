'use strict';

const constants = require('./constants');
const audioAssets = require('./audioAssets');
const requests = require('./requests');
const htmlToText = require('./htmlToText');

let AWS = require('aws-sdk');
AWS.config.update({
    region: 'us-east-1'
});
let dynamodb = new AWS.DynamoDB.DocumentClient({
    region: 'us-east-1'
});

function respond(article, index, callback) {
    let params = {
        TableName: constants.playlistTableName,
        Key: {
            "access_token": article.access_token,
            "order": index
        },
        UpdateExpression: "set curr_index = :i",
        ExpressionAttributeValues: {
            ":i": article.curr_index + 1
        },
        ReturnValues: "UPDATED_NEW"
    };
    console.log("update playlist item query: " + JSON.stringify(params));
    dynamodb.update(params, function (err, data) {
        if (err) {
            console.log("Unable to update item: " + "\n" + JSON.stringify(err, undefined, 2));
        } else {
            console.log("UpdateItem succeeded: " + "\n" + JSON.stringify(data, undefined, 2));
            audioAssets.get(article, callback);
        }
    });
}

function getNextAudioAsset(access_token, index, callback) {
    let params = {
        TableName: constants.playlistTableName,
        Key: {
            access_token: access_token,
            order: index
        }
    };
    console.log("playlist items query:", JSON.stringify(params));
    // let self = this;
    dynamodb.get(params, function (err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            console.log("playlist items query result:", JSON.stringify(data));
            let article = data.Item;
            let params = {
                TableName: constants.audioAssetTableName,
                KeyConditionExpression: "(#article_key = :article) AND (#index = :curr_index)",
                ExpressionAttributeNames: {
                    "#article_key": "key",
                    "#index": "index"
                },
                ExpressionAttributeValues: {
                    ":article": article.article_key,
                    ":curr_index": article.curr_index
                },
                Select: "COUNT"
            };
            console.log("audio asset query:", JSON.stringify(params));
            dynamodb.query(params, function (err, data) {
                console.log("audio asset query response:", JSON.stringify(data));
                if (!err) {
                    if (data.Count > 0) {
                        console.log("Asset exists");
                        respond(article, index, callback);
                    } else {
                        console.log("Asset doesn't exist");
                        let params = {
                            TableName: constants.pollyQueueTableName,
                            KeyConditionExpression: "(#article_key = :article) AND (#index = :curr_index)",
                            ExpressionAttributeNames: {
                                "#article_key": "key",
                                "#index": "index"
                            },
                            ExpressionAttributeValues: {
                                ":article": article.article_key,
                                ":curr_index": article.curr_index
                            },
                            Select: "COUNT"
                        };
                        console.log("polly queue query:", JSON.stringify(params));
                        dynamodb.query(params, function (err, data) {
                            console.log("audio asset query response:", JSON.stringify(data));
                            if (!err) {
                                if (data.Count > 0) {
                                    respond(article, index, callback);
                                } else {
                                    // Use Pocket's Article View API to obtain the parsed text of the articles.
                                    let request_data = {
                                        'consumer_key': String(process.env.POCKET_CONSUMER_KEY),
                                        'url': encodeURIComponent(article.article_url),
                                        'images': '0',
                                        'videos': '0',
                                        'refresh': '0',
                                        'output': 'json'
                                    };
                                    let url = 'https://text.getpocket.com/v3/text';
                                    requests.makeRequest(url, request_data, function (err, res) {
                                        if (!err) {
                                            console.log("Article View response:", JSON.stringify(res));
                                            let response_texts = htmlToText.convert(res.article);
                                            let batchWriteParams = {
                                                RequestItems: {}
                                            };
                                            batchWriteParams.RequestItems[constants.pollyQueueTableName] = [];
                                            response_texts.forEach(function (response_text, index, response_texts) {
                                                batchWriteParams.RequestItems[constants.pollyQueueTableName].push({
                                                    PutRequest: {
                                                        Item: {
                                                            key: article.article_key,
                                                            index: index,
                                                            numSlices: response_texts.length,
                                                            title: res.title,
                                                            text: response_text
                                                        }
                                                    }
                                                });
                                                if (index + 1 >= response_texts.length) {
                                                    console.log("put audio asset and playlist entry batchWrite:", JSON.stringify(batchWriteParams));
                                                    let arrays = [];
                                                    const size = 25;
                                                    console.log("batchWriteParams keys:", JSON.stringify(Object.keys(batchWriteParams.RequestItems)));
                                                    Object.keys(batchWriteParams.RequestItems).forEach(function (key, index, keys) {
                                                        console.log(key, index, keys.length);
                                                        let a = batchWriteParams.RequestItems[key];
                                                        while (a.length > 0) {
                                                            let temp = {
                                                                RequestItems: {}
                                                            };
                                                            temp.RequestItems[key] = a.splice(0, size);
                                                            arrays.push(temp);
                                                        }
                                                        if (index + 1 >= keys.length) {
                                                            console.log("split batchWrite params:", JSON.stringify(arrays));
                                                            arrays.forEach(function (params, index, paramsArray) {
                                                                dynamodb.batchWrite(params, function (err, data) {
                                                                    if (err) {
                                                                        console.log('ERROR: Dynamo failed: ' + err);
                                                                    } else {
                                                                        console.log('put polly queue batchWrite success');
                                                                        if (index + 1 >= paramsArray.length)
                                                                            respond(article, index, callback);
                                                                        // audioAssets.get(article.article_key, article.article_index, callback);
                                                                    }
                                                                });
                                                            });
                                                        }
                                                    });
                                                }
                                            });
                                        }
                                    }, "FORM");
                                }
                            } else {
                                console.log(err, err.stack);
                            }
                        });
                    }
                } else {
                    console.log(err, err.stack);
                }
            });
        }
    });
}
exports.getNextAudioAsset = getNextAudioAsset;