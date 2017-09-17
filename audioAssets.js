'use strict';

const constants = require('./constants');

let AWS = require('aws-sdk');
AWS.config.update({
    region: 'us-east-1'
});
let dynamodb = new AWS.DynamoDB.DocumentClient({
    region: 'us-east-1'
});

// If numSlices is not a property of the playlist table entry, add it for quicker/easier
// querying in the future.
function addNumSlices(playlist_item, numSlices, callback) {
    if (!playlist_item.hasOwnProperty("numSlices")) {
        let params = {
            TableName: constants.playlistTableName,
            Key: {
                "access_token": playlist_item.access_token,
                "order": playlist_item.curr_index
            },
            UpdateExpression: "set numSlices = :s",
            ExpressionAttributeValues: {
                ":s": numSlices
            },
            ReturnValues: "UPDATED_NEW"
        };
        // console.log("update playlist item query: " + JSON.stringify(params));
        dynamodb.update(params, function (err, data) {
            if (err) {
                console.log("Unable to update item: " + "\n" + JSON.stringify(err, undefined, 2));
            } else {
                console.log("UpdateItem succeeded: " + "\n" + JSON.stringify(data, undefined, 2));
                callback();
            }
        });
    } else {
        callback();
    }
}

function getNextAudioAsset(playlist_item, callback) {
    setTimeout(function () {
        console.log("current playlist item: " + JSON.stringify(playlist_item));
        var next_playlist_item = playlist_item;
        ++next_playlist_item.curr_index;
        console.log("next playlist item: " + JSON.stringify(next_playlist_item));
        getAudioAsset(next_playlist_item, callback);
    }, 100);
}

function getAudioAsset(playlist_item, callback) {
    let key = playlist_item.article_key;
    let index = playlist_item.curr_index;
    let params = {
        TableName: constants.audioAssetTableName,
        Key: {
            key: key,
            index: index
        }
    };
    // console.log("get audio asset query:", JSON.stringify(params));
    dynamodb.get(params, function (err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            console.log("get audio asset result:", JSON.stringify(data));
            if (data.Item) {
                console.log("audio asset exists");
                addNumSlices(playlist_item, data.Item.numSlices, function () {
                    if ((playlist_item.curr_index + 1) < data.Item.numSlices) {
                        // Made an anomymous function to solve reliability issues of timeout
                        // credit: https://stackoverflow.com/questions/2171602/settimeout-and-anonymous-function-problem
                        (function (playlist_item) {
                            getNextAudioAsset(playlist_item, function () {
                                console.log("Finished fetch next item");
                            });
                        })(playlist_item);
                    }
                    callback(data.Item);
                });
            } else {
                let params = {
                    TableName: constants.pollyQueueTableName,
                    Key: {
                        key: key,
                        index: index
                    }
                };
                // console.log("get queued polly request query:", JSON.stringify(params));
                dynamodb.get(params, function (err, data) {
                    if (err) {
                        console.log(err, err.stack);
                    } else {
                        // console.log("get queued polly request query response:", JSON.stringify(data));
                        if (data.Item) {
                            let article = data.Item;
                            const output_format = constants.audioAssetFormat;
                            let params = {
                                OutputFormat: output_format,
                                Text: article.text,
                                TextType: "text",
                                VoiceId: "Joanna"
                            };
                            console.log("polly request: " + JSON.stringify(params));

                            var polly = new AWS.Polly();
                            polly.synthesizeSpeech(params, function (err, data) {
                                if (err) console.log("ERROR", err, err.stack); // an error occurred
                                else {
                                    console.log(data); // successful response
                                    const fileName = `${article.key}-${article.index}.${output_format}`;
                                    const bucket = constants.audioAssetBucket;
                                    let param = {
                                        Bucket: bucket,
                                        Key: fileName,
                                        Body: data.AudioStream,
                                        ACL: 'public-read'
                                    };

                                    let s3 = new AWS.S3();
                                    s3.putObject(param, function (resp) {
                                        console.log('Successfully uploaded package.');

                                        let url = `https://s3.amazonaws.com/${bucket}/${fileName}`;
                                        console.log(`URL is ${url}`);
                                        let batchWriteParams = {
                                            RequestItems: {}
                                        };
                                        batchWriteParams.RequestItems[constants.audioAssetTableName] = [{
                                            PutRequest: {
                                                Item: {
                                                    title: article.title,
                                                    url: url,
                                                    key: article.key,
                                                    index: article.index,
                                                    numSlices: article.numSlices
                                                }
                                            }
                                        }];
                                        batchWriteParams.RequestItems[constants.pollyQueueTableName] = [{
                                            DeleteRequest: {
                                                Key: {
                                                    key: article.key,
                                                    index: article.index
                                                }
                                            }
                                        }];
                                        dynamodb.batchWrite(batchWriteParams, function (err) {
                                            if (err) console.log("ERROR", err, err.stack); // an error occurred
                                            // else console.log("Batch write successful, asset put in table, deleted from Polly queue");
                                            addNumSlices(playlist_item, batchWriteParams.RequestItems[constants.audioAssetTableName][0].PutRequest.Item.numSlices, function () {
                                                callback(batchWriteParams.RequestItems[constants.audioAssetTableName][0].PutRequest.Item);
                                            });
                                        });
                                    });
                                }
                            });
                        }
                    }
                });
            }
        }
    });
}

function deleteAudioAsset(playlist_item, callback) {
    let s3 = new AWS.S3();
    let assetKey = `${playlist_item.article_key}-${playlist_item.curr_index}.${constants.audioAssetFormat}`;
    let params = {
        Bucket: constants.audioAssetBucket,
        Key: assetKey
    };
    s3.deleteObject(params, function (err, data) {
        let params = {
            Key: {
                key: playlist_item.article_key,
                index: playlist_item.curr_index
            },
            TableName: constants.audioAssetTableName
        }
        if (err) {
            console.log(err, err.stack); // an error occurred
            params.TableName = constants.pollyQueueTableName;
        }
        dynamodb.delete(params, function (err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            else {
                callback({
                    key: assetKey
                });
            }
        });
    });
}

exports.get = getAudioAsset;
exports.delete = deleteAudioAsset;