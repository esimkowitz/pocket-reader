'use strict';

const Alexa = require('alexa-sdk');
// var audioData = {};
const constants = require('./constants');
let AWS = require('aws-sdk');
AWS.config.update({
    region: 'us-east-1'
});
let dynamodb = new AWS.DynamoDB.DocumentClient({
    region: 'us-east-1'
});

// Binding audio handlers to PLAY_MODE State since they are expected only in this mode.
let audioEventHandlers = Alexa.CreateStateHandler(constants.states.PLAY_MODE, {
    'PlaybackStarted': function () {
        /*
         * AudioPlayer.PlaybackStarted Directive received.
         * Confirming that requested audio file began playing.
         * Storing details in dynamoDB using attributes.
         */
        this.attributes['token'] = getToken.call(this);
        this.attributes['index'] = getIndex.call(this);
        this.attributes['playbackFinished'] = false;
        this.emit(':saveState', true);
    },
    'PlaybackFinished': function () {
        /*
         * AudioPlayer.PlaybackFinished Directive received.
         * Confirming that audio file completed playing.
         * Storing details in dynamoDB using attributes.
         */
        this.attributes['playbackFinished'] = true;
        this.attributes['enqueuedToken'] = false;
        this.emit(':saveState', true);
    },
    'PlaybackStopped': function () {
        /*
         * AudioPlayer.PlaybackStopped Directive received.
         * Confirming that audio file stopped playing.
         * Storing details in dynamoDB using attributes.
         */
        this.attributes['token'] = getToken.call(this);
        this.attributes['index'] = getIndex.call(this);
        this.attributes['offsetInMilliseconds'] = getOffsetInMilliseconds.call(this);
        this.emit(':saveState', true);
    },
    'PlaybackNearlyFinished': function () {
        /*
         * AudioPlayer.PlaybackNearlyFinished Directive received.
         * Using this opportunity to enqueue the next audio
         * Storing details in dynamoDB using attributes.
         * Enqueuing the next audio file.
         */
        // console.log(JSON.stringify(this.event));
        console.log("PlaybackNearlyFinished");
        if (this.attributes['enqueuedToken']) {
            /*
             * Since AudioPlayer.PlaybackNearlyFinished Directive are prone to be delivered multiple times during the
             * same audio being played.
             * If an audio file is already enqueued, exit without enqueuing again.
             */
            return this.context.succeed(true);
        }

        var enqueueIndex = this.attributes['index'];
        enqueueIndex += 1;
        // Checking if  there are any items to be enqueued.
        let access_token = this.event.context.System.user.accessToken;
        let params = {
            TableName: constants.playlistTableName,
            KeyConditionExpression: "#token = :access_token",
            ExpressionAttributeNames: {
                "#token": "access_token"
            },
            ExpressionAttributeValues: {
                ":access_token": access_token
            },
            Select: "COUNT"
        };
        console.log("playlist numItems query:", JSON.stringify(params));
        let self = this;
        dynamodb.query(params, function (err, data) {
            if (err) {
                console.log(err, err.stack);
            } else {
                if (enqueueIndex >= data.Count) {
                    if (self.attributes['loop']) {
                        // Enqueueing the first item since looping is enabled.
                        enqueueIndex = 0;
                    } else {
                        // Nothing to enqueue since reached end of the list and looping is disabled.
                        return self.context.succeed(true);
                    }
                }
                // Setting attributes to indicate item is enqueued.
                self.attributes['enqueuedToken'] = String(self.attributes['playOrder'][enqueueIndex]);

                var enqueueToken = self.attributes['enqueuedToken'];
                var playBehavior = 'ENQUEUE';
                let params = {
                    TableName: constants.playlistTableName,
                    KeyConditionExpression: "(#token = :access_token) AND (#order = :curr_index)",
                    ExpressionAttributeNames: {
                        "#token": "access_token",
                        "#order": "order"
                    },
                    ExpressionAttributeValues: {
                        ":access_token": access_token,
                        ":curr_index": self.attributes['playOrder'][enqueueIndex]
                    }
                };
                console.log("playlist items query:", JSON.stringify(params));
                dynamodb.query(params, function (err, data) {
                    if (err) {
                        console.log(err, err.stack);
                    } else {
                        console.log("playlist items result:", JSON.stringify(data));
                        let params = {
                            Key: {
                                "key": data.Items[0].article_key
                            },
                            TableName: constants.audioAssetTableName
                        };
                        console.log("get audio asset query:", JSON.stringify(params));
                        dynamodb.get(params, function (err, data) {
                            if (err) {
                                console.log(err, err.stack);
                            } else {
                                console.log("get audio asset result:", JSON.stringify(data));
                                let podcast = data.Item;
                                var expectedPreviousToken = self.attributes['token'];
                                var offsetInMilliseconds = 0;

                                self.response.audioPlayerPlay(playBehavior, podcast.url, enqueueToken, expectedPreviousToken, offsetInMilliseconds);
                                self.emit(':responseReady');
                            }
                        });
                    }
                });
            }
        });
    },
    'PlaybackFailed': function () {
        //  AudioPlayer.PlaybackNearlyFinished Directive received. Logging the error.
        console.log("Playback Failed : %j", this.event.request.error);
        this.context.succeed(true);
    }
});

module.exports = audioEventHandlers;

function getToken() {
    // Extracting token received in the request.
    return this.event.request.token;
}

function getIndex() {
    // Extracting index from the token received in the request.
    var tokenValue = parseInt(this.event.request.token);
    return this.attributes['playOrder'].indexOf(tokenValue);
}

function getOffsetInMilliseconds() {
    // Extracting offsetInMilliseconds received in the request.
    return this.event.request.offsetInMilliseconds;
}