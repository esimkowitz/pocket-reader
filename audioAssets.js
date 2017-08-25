'use strict';

const constants = require('./constants');

let AWS = require('aws-sdk');
AWS.config.update({
    region: 'us-east-1'
});
let dynamodb = new AWS.DynamoDB.DocumentClient({
    region: 'us-east-1'
});

function getAudioAsset(key, index, callback) {
    let params = {
        TableName: constants.audioAssetTableName,
        Key: {
            key: key,
            index: index
        }
    };
    console.log("get audio asset query:", JSON.stringify(params));
    dynamodb.get(params, function (err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            console.log("get audio asset result:", JSON.stringify(data));
            if (data.Item) {
                console.log("audio asset exists");
                callback(data.Item);
            } else {
                let params = {
                    TableName: constants.pollyQueueTableName,
                    Key: {
                        key: key,
                        index: index
                    }
                };
                console.log("get queued polly request query:", JSON.stringify(params));
                dynamodb.get(params, function (err, data) {
                    if (err) {
                        console.log(err, err.stack);
                    } else {
                        console.log("get queued polly request query response:", JSON.stringify(data));
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

                                    var s3 = new AWS.S3();
                                    s3.putObject(param, function (resp) {
                                        console.log('Successfully uploaded package.');

                                        let url = `https://s3.amazonaws.com/${bucket}/${fileName}`;
                                        console.log(`URL is ${url}`);
                                        let batchWriteParams = {
                                            RequestItems: {}
                                        };
                                        batchWriteParams.RequestItems[constants.audioAssetTableName] = [
                                            {
                                                PutRequest: {
                                                    Item: {
                                                        title: article.title,
                                                        url: url,
                                                        key: article.key,
                                                        index: article.index,
                                                        numSlices: article.numSlices
                                                    }
                                                }
                                            }
                                        ];
                                        batchWriteParams.RequestItems[constants.pollyQueueTableName] = [
                                            {
                                                DeleteRequest: {
                                                    Key: {
                                                        key: article.key,
                                                        index: article.index
                                                    }
                                                }
                                            }
                                        ];
                                        dynamodb.batchWrite(batchWriteParams, function (err) {
                                            if (err) console.log("ERROR", err, err.stack); // an error occurred
                                            else console.log("Batch write successful, asset put in table, deleted from Polly queue");
                                            callback(batchWriteParams.RequestItems[constants.audioAssetTableName][0].PutRequest.Item);
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

exports.get = getAudioAsset;