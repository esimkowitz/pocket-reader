'use strict';

const constants = require('./constants');
const audioAssets = require('./audioAssets');
const requests = require('./requests');
const htmlToText = require('./htmlToText');
const EventEmitter = require('events');

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
        UpdateExpression: "set #I = :i",
        ExpressionAttributeNames: {
            "#I": "curr_index"
        },
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
            audioAssets.get(article, callback);
        }
    });
}

function clearOldAudioAssets(article, callback, delete_all = false) {
    var numAssetsToDelete = 0;
    let emitter = new EventEmitter;
    emitter.on('done', function (deletedAsset) {
        deletedAssets.push(deletedAsset);
        if (deletedAssets.length >= numAssetsToDelete) {
            callback(deletedAssets);
        }
    });
    var deletedAssets = [];
    let curr_index = 0;
    let numSlices = 0;
    if ('curr_index' in article) {
        curr_index = article.curr_index;
    }
    if ('numSlices' in article) {
        numSlices = article.numSlices;
    }

    let end_index = delete_all ? numSlices : (curr_index - 1);
    numAssetsToDelete = end_index;
    let deleteTableEntries = delete_all;
    for (var i = 0; i < end_index; ++i) {
        var asset_delete = article;
        asset_delete.curr_index = i;
        // console.log('asset to be deleted: ' + JSON.stringify(asset_delete));
        (function (asset_delete, deleteTableEntries) {
            setImmediate(function () {
                audioAssets.delete(asset_delete, function (deletedAsset) {
                    console.log('asset deleted: ' + JSON.stringify(deletedAsset));
                    emitter.emit('done', deletedAsset);
                }, deleteTableEntries);
            });
        })(asset_delete, deleteTableEntries);
    }
    // callback({});
    // if (delete_all)
    // const params = {
    //     TableName: constants.playlistTableName,
    //     Key: {
    //         "access_token": article.access_token,
    //         "order": article_index
    //     },
    //     UpdateExpression: "set curr_index = :i",
    //     ExpressionAttributeValues: {
    //         ":i": 0
    //     },
    //     ReturnValues: "UPDATED_NEW"
    // };
    // // console.log("update playlist item query: " + JSON.stringify(params));
    // dynamodb.update(params, function (err, data) {
    //     if (err) {
    //         console.log("Unable to update item: " + "\n" + JSON.stringify(err, undefined, 2));
    //     } else {
    //         console.log('updated the table entry');
    //     }
    // });
}

function getNextAudioAsset(access_token, index, callback) {
    let params = {
        TableName: constants.playlistTableName,
        Key: {
            access_token: access_token,
            order: index
        }
    };
    // console.log("playlist items query:", JSON.stringify(params));
    // let self = this;
    dynamodb.get(params, function (err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            // console.log("playlist items query result:", JSON.stringify(data));
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
                // console.log("audio asset query response:", JSON.stringify(data));
                if (!err) {
                    if (data.Count > 0) {
                        console.log("Asset exists");
                        respond(article, index, callback);
                    } else {
                        console.log("Asset doesn't exist");
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
                                // console.log("Article View response:", JSON.stringify(res));
                                let response_texts = htmlToText.convert(res.article);

                                // Push the title and the date the article was published to the front of the response_texts array so
                                // that they'll be announced ahead of the article playing.

                                // FIXME: Article title is sometimes twice before the date is played, figure out why
                                var datePublished = new Date(res.datePublished);
                                response_texts.unshift(datePublished.toDateString());
                                response_texts.unshift(res.title);
                                console.log("article authors: " + JSON.stringify(res.authors));

                                let batchWriteParams = {
                                    RequestItems: {}
                                };
                                console.log("response_texts: " + JSON.stringify(response_texts));
                                batchWriteParams.RequestItems[constants.audioAssetTableName] = [];
                                response_texts.forEach(function (response_text, responseIndex, response_texts) {
                                    batchWriteParams.RequestItems[constants.audioAssetTableName].push({
                                        PutRequest: {
                                            Item: {
                                                key: article.article_key,
                                                index: responseIndex,
                                                numSlices: response_texts.length,
                                                title: res.title,
                                                text: response_text,
                                                downloaded: false
                                            }
                                        }
                                    });
                                    if (responseIndex + 1 >= response_texts.length) {
                                        // console.log("put audio asset and playlist entry batchWrite:", JSON.stringify(batchWriteParams));
                                        let arrays = [];
                                        const size = 25;
                                        // console.log("batchWriteParams keys:", JSON.stringify(Object.keys(batchWriteParams.RequestItems)));
                                        Object.keys(batchWriteParams.RequestItems).forEach(function (key, keysIndex, keys) {
                                            console.log(key, keysIndex, keys.length);
                                            let a = batchWriteParams.RequestItems[key];
                                            while (a.length > 0) {
                                                let temp = {
                                                    RequestItems: {}
                                                };
                                                temp.RequestItems[key] = a.splice(0, size);
                                                arrays.push(temp);
                                            }
                                            if (keysIndex + 1 >= keys.length) {
                                                // console.log("split batchWrite params:", JSON.stringify(arrays));
                                                arrays.forEach(function (params, paramsIndex, paramsArray) {
                                                    dynamodb.batchWrite(params, function (err, data) {
                                                        if (err) {
                                                            console.log('ERROR: Dynamo failed: ' + err);
                                                        } else {
                                                            // console.log('put polly queue batchWrite success');
                                                            if (paramsIndex + 1 >= paramsArray.length)
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
    });
}
exports.getNextAudioAsset = getNextAudioAsset;
exports.clearOldAudioAssets = clearOldAudioAssets;