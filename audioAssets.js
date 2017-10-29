'use strict';

const constants = require('./constants');

let AWS = require('aws-sdk');
AWS.config.update({
    region: 'us-east-1'
});
let dynamodb = new AWS.DynamoDB.DocumentClient({
    region: 'us-east-1'
});

function getNextAudioAsset(playlist_item, callback) {
    setTimeout(function () {
        console.log("current playlist item: " + JSON.stringify(playlist_item));
        var next_playlist_item = playlist_item;
        ++next_playlist_item.curr_index;
        console.log("next playlist item: " + JSON.stringify(next_playlist_item));
        getAudioAsset(next_playlist_item, callback, false);
    }, 100);
}

function getAudioAsset(playlist_item, callback, getAnother = true) {
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
                let audio_asset = data.Item;
                if (audio_asset.downloaded) {
                    console.log("audio asset exists");

                    if (((index + 1) < audio_asset.numSlices) && getAnother) {
                        // Made an anomymous function to solve reliability issues of timeout
                        // credit: https://stackoverflow.com/questions/2171602/settimeout-and-anonymous-function-problem
                        (function (playlist_item) {
                            getNextAudioAsset(playlist_item, function () {
                                console.log("Finished fetch next item");
                            });
                        })(playlist_item);
                    }
                    callback(audio_asset);
                } else {
                    const output_format = constants.audioAssetFormat;
                    let params = {
                        OutputFormat: output_format,
                        Text: audio_asset.text,
                        TextType: "text",
                        VoiceId: "Joanna"
                    };
                    console.log("polly request: " + JSON.stringify(params));

                    var polly = new AWS.Polly();
                    polly.synthesizeSpeech(params, function (err, data) {
                        if (err) console.log("ERROR", err, err.stack); // an error occurred
                        else {
                            console.log(data); // successful response
                            const fileName = `${key}-${index}.${output_format}`;
                            const bucket = constants.audioAssetBucket;
                            let param = {
                                Bucket: bucket,
                                Key: fileName,
                                Body: data.AudioStream,
                                ACL: 'public-read',
                                Tagging: "EXPIRETIME=24&EXPIRE=True"
                            };

                            let s3 = new AWS.S3();
                            s3.putObject(param, function (resp) {
                                console.log('Successfully uploaded package.');

                                let url = `https://s3.amazonaws.com/${bucket}/${fileName}`;
                                console.log(`URL is ${url}`);
                                let params = {
                                    ExpressionAttributeNames: {
                                        "#U": "url",
                                        "#D": "downloaded"
                                    },
                                    ExpressionAttributeValues: {
                                        ":u": url,
                                        ":d": true
                                    },
                                    Key: {
                                        key: key,
                                        index: index
                                    },
                                    UpdateExpression: "SET #U = :u, #D = :d",
                                    TableName: constants.audioAssetTableName
                                }
                                dynamodb.update(params, function (err) {
                                    if (err) console.log("ERROR", err, err.stack); // an error occurred
                                    audio_asset.url = url;
                                    audio_asset.downloaded = true;
                                    if (((index + 1) < audio_asset.numSlices) && getAnother) {
                                        // Made an anomymous function to solve reliability issues of timeout
                                        // credit: https://stackoverflow.com/questions/2171602/settimeout-and-anonymous-function-problem
                                        (function (playlist_item) {
                                            getNextAudioAsset(playlist_item, function () {
                                                console.log("Finished fetch next item");
                                            });
                                        })(playlist_item);
                                    }
                                    callback(audio_asset);
                                });
                            });
                        }
                    });
                }
            }
        }
    });
}

function deleteAudioAsset(playlist_item, deleteAsset, callback, deleteTableEntry = false) {
    let s3 = new AWS.S3();
    const key = playlist_item.key;
    const index = playlist_item.index;
    // console.log("item to delete: " + JSON.stringify(playlist_item));
    const dynamo_params = {
        TableName: constants.audioAssetTableName,
        Key: {
            key: key,
            index: index
        }
    };

    const assetKey = `${key}-${index}.${constants.audioAssetFormat}`;
    const s3_params = {
        Bucket: constants.audioAssetBucket,
        Key: assetKey
    };
    if (deleteAsset) {
        s3.deleteObject(s3_params, function (err, data) {
            if (err) {
                console.log("s3 delete object error:", err, err.stack); // an error occurred
                // callback({});
            } else {
                console.log("s3 object deleted");
                if (!deleteTableEntry) {
                    const dynamo_update_params = {
                        ExpressionAttributeValues: {
                            ":d": false
                        },
                        ExpressionAttributeNames: {
                            "#D": "downloaded"
                        },
                        Key: {
                            key: key,
                            index: index
                        },
                        UpdateExpression: "SET #D = :d",
                        TableName: constants.audioAssetTableName
                    };
                    dynamodb.update(dynamo_update_params, function (err) {
                        if (err) console.log("DynamoDB update item error:", err, err.stack); // an error occurred
                    });
                }
            }
        });
    }
    if (deleteTableEntry) {
        // console.log("dynamobb delete item params: " + JSON.stringify(dynamo_params));
        dynamodb.delete(dynamo_params, function (err, data) {
            if (err) console.log("DynamoDB delete item error:", err, err.stack); // an error occurred
            else {
                callback(playlist_item);
            }
        });
    } else {
        callback(playlist_item);
    }
}

exports.get = getAudioAsset;
exports.delete = deleteAudioAsset;