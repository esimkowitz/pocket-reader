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

// TODO: Move the curr_index update to the PlaybackStarted handler in audioEventHandlers.js
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
    var deletedAssets = [];

    emitter.on('done', function (deletedAsset) {
        deletedAssets.push(deletedAsset);
        if (deletedAssets.length >= numAssetsToDelete) {
            callback(deletedAssets);
        }
    });
    let curr_index = 0;
    if ('curr_index' in article) {
        curr_index = article.curr_index;
    }
    let dynamoParams = {};
    if (delete_all) {
        // if we are deleting all the entries, we want the full list of audioAssets
        dynamoParams = {
            TableName: constants.audioAssetTableName,
            KeyConditionExpression: "#primaryIndex = :p",
            ExpressionAttributeNames: {
                "#primaryIndex": "key"
            },
            ExpressionAttributeValues: {
                ":p": article.article_key
            }
        };
    } else {
        // if we are not deleting all the entries, we only want a list of the downloaded audioAssets that
        // come before the current asset.
        dynamoParams = {
            TableName: constants.audioAssetTableName,
            KeyConditionExpression: "#primaryIndex = :p AND #secondaryIndex < :s",
            FilterExpression: "#filterIndex = :f",
            ExpressionAttributeNames: {
                "#primaryIndex": "key",
                "#secondaryIndex": "index",
                "#filterIndex": "downloaded"
            },
            ExpressionAttributeValues: {
                ":p": article.article_key,
                ":f": true,
                ":s": curr_index
            }
        };
    }
    // console.log("assets to delete query: " + JSON.stringify(dynamoParams));

    // Query DynamoDB using the params from above, call audioAssets.delete to delete the asset and/or its table entry
    // We only delete the table entry if we're deleting all the entries.
    dynamodb.query(dynamoParams, function (err, data) {
        if (err) console.log("DynamoDB error: " + err.stack);
        else {
            console.log("reading assets to delete: " + JSON.stringify(data));
            numAssetsToDelete = data.Count;

            let deleteTableEntries = delete_all;

            for (let item in data.Items) {
                (function (asset_delete, deleteTableEntries) {
                    setImmediate(function () {
                        let needToDelete = asset_delete.downloaded;
                        audioAssets.delete(asset_delete, needToDelete, function (deletedAsset) {
                            console.log('asset deleted: ' + JSON.stringify(deletedAsset));
                            emitter.emit('done', deletedAsset);
                        }, deleteTableEntries);
                    });
                })(data.Items[item], deleteTableEntries);
            }
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