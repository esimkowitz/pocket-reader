'use strict';

const Alexa = require('alexa-sdk');
const constants = require('./constants');
const playlist = require('./playlist');

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
        console.log("PlaybackStarted Request");
        this.attributes['token'] = getToken.call(this);
        this.attributes['index'] = getIndex.call(this);
        this.attributes['currArticleIndex'] = 'nextArticleIndex' in this.attributes ? this.attributes['nextArticleIndex'] : 0;

        this.attributes['playbackFinished'] = false;
        console.log("this.attributes:", JSON.stringify(this.attributes));
        this.emit(':saveState', true);
    },
    'PlaybackFinished': function () {
        /*
         * AudioPlayer.PlaybackFinished Directive received.
         * Confirming that audio file completed playing.
         * Storing details in dynamoDB using attributes.
         * Deleting already-played audio assets.
         */
        console.log("PlaybackFinished Request");
        this.attributes['playbackFinished'] = true;
        this.attributes['enqueuedToken'] = false;
        let access_token = this.event.context.System.user.accessToken;

        this.attributes['token'] = getToken.call(this);
        this.attributes['index'] = getIndex.call(this);
        let enqueueIndex = this.attributes['index'];
        let curr_index = this.attributes['currArticleIndex'];
        console.log("this.attributes:", JSON.stringify(this.attributes));

        let params = {
            TableName: constants.playlistTableName,
            Key: {
                access_token: access_token,
                order: enqueueIndex
            }
        };
        // console.log("playlist numItems query:", JSON.stringify(params));
        let self = this;
        dynamodb.get(params, function (err, data) {
            if (err) {
                console.log("error with playlist query", err, err.stack);
            } else {
                let item_to_delete = data.Item;
                item_to_delete.curr_index = curr_index;
                // FIXME: adding the functionality to delete already-played audio assets will introduce a bug where articles that aren't finished will be restarted and
                // the full text will be fetched again, but once the snippet gets to the part of the article where the person stopped last, it'll find the existing unplayed
                // audio assets and will begin playing those, leaving the remaining polly requests for that article queued.
                // Come up with a way to either purge all audio assets for a playlist item when a person pauses playback or search and delete forgotten queued polly requests
                // The first probably makes the most sense (just iterate through numSlices and call the new audioAssets.delete function when playback stops)

                // FIXME: Introduces bug where the playback gets stuck on one audio asset, playing it on repeat
                // TODO: what about in cases where multiple people are listening to the same article? A more extensive (and thought-out) solution may be needed to account for this.

                // FIXME: the first and last audio assets for each article aren't deleted
                (function (item_to_delete) {
                    setImmediate(function () {
                        console.log("article whose assets to delete: " + JSON.stringify(item_to_delete));
                        playlist.clearOldAudioAssets(item_to_delete, function (data) {
                            console.log("audio assets cleared: " + JSON.stringify(data));
                        });
                    });
                })(item_to_delete);
            }

            self.emit(':saveState', true);
        });
    },
    'PlaybackStopped': function () {
        /*
         * AudioPlayer.PlaybackStopped Directive received.
         * Confirming that audio file stopped playing.
         * Storing details in dynamoDB using attributes.
         */
        console.log("PlaybackStopped Request");
        this.attributes['token'] = getToken.call(this);
        this.attributes['index'] = getIndex.call(this);
        let access_token = this.event.context.System.user.accessToken;
        let enqueueIndex = this.attributes['index'];

        let params = {
            TableName: constants.playlistTableName,
            Key: {
                access_token: access_token,
                order: enqueueIndex
            }
        };
        // console.log("playlist numItems query:", JSON.stringify(params));
        let self = this;
        dynamodb.get(params, function (err, data) {
            if (err) {
                console.log("error with playlist query", err, err.stack);
            } else {

                // FIXME: adding the functionality to delete already-played audio assets will introduce a bug where articles that aren't finished will be restarted and
                // the full text will be fetched again, but once the snippet gets to the part of the article where the person stopped last, it'll find the existing unplayed
                // audio assets and will begin playing those, leaving the remaining polly requests for that article queued.
                // Come up with a way to either purge all audio assets for a playlist item when a person pauses playback or search and delete forgotten queued polly requests
                // The first probably makes the most sense (just iterate through numSlices and call the new audioAssets.delete function when playback stops)

                // FIXME: Introduces bug where the playback gets stuck on one audio asset, playing it on repeat
                // TODO: what about in cases where multiple people are listening to the same article? A more extensive (and thought-out) solution may be needed to account for this.

                // FIXME: the first and last audio assets for each article aren't deleted
                (function (data) {
                    setImmediate(function () {
                        console.log("article whose assets to delete: " + JSON.stringify(data));
                        playlist.clearOldAudioAssets(data.Item, function (data) {
                            console.log("audio assets cleared: " + JSON.stringify(data));
                        }, true);
                    });
                })(data);
            }
        });
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
        console.log("PlaybackNearlyFinished Request");
        this.attributes['token'] = getToken.call(this);
        this.attributes['index'] = getIndex.call(this);
        console.log("this.attributes", JSON.stringify(this.attributes));
        if ((this.attributes['enqueuedToken'] !== null) && (this.attributes['enqueuedToken'] !== false) && (this.attributes['enqueuedToken'] !== this.attributes['token'])) {
            /*
             * Since AudioPlayer.PlaybackNearlyFinished Directive are prone to be delivered multiple times during the
             * same audio being played.
             * If an audio file is already enqueued, exit without enqueuing again.
             */
            return this.context.succeed(true);
        }
        // Checking if  there are any items to be enqueued.
        let access_token = this.event.context.System.user.accessToken;
        let params = {
            TableName: constants.playlistTableName,
            KeyConditionExpression: "access_token = :t",
            ExpressionAttributeValues: {
                ":t": access_token
            }
        };
        // console.log("playlist numItems query:", JSON.stringify(params));
        let self = this;
        dynamodb.query(params, function (err, data) {
            if (err) {
                console.log("error with playlist query", err, err.stack);
            } else {
                let enqueueIndex = self.attributes['index'];
                let article = data.Items[enqueueIndex];
                console.log("Current article: " + JSON.stringify(article));
                if (article.curr_index >= article.numSlices) {
                    enqueueIndex += 1;
                }
                console.log("enqueueIndex", enqueueIndex, "data.Count", data.Count);
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
                self.attributes['enqueuedToken'] = `${self.attributes['playOrder'][enqueueIndex]}-${article.curr_index}`;
                self.attributes['nextArticleIndex'] = article.curr_index;

                let enqueueToken = self.attributes['enqueuedToken'];
                const playBehavior = 'ENQUEUE';
                playlist.getNextAudioAsset(access_token, self.attributes['playOrder'][enqueueIndex], function (audioAsset) {
                    console.log("audioAsset", JSON.stringify(audioAsset));
                    let expectedPreviousToken = self.attributes['token'];
                    let offsetInMilliseconds = 0;

                    self.response.audioPlayerPlay(playBehavior, audioAsset.url, enqueueToken, expectedPreviousToken, offsetInMilliseconds);
                    console.log("response:", JSON.stringify(self.response));
                    self.emit(':responseReady');
                });
            }
        });
    },
    'PlaybackFailed': function () {
        //  AudioPlayer.PlaybackNearlyFinished Directive received. Logging the error.
        console.log("Playback Failed : %j", this.event.request.error);
        let access_token = this.event.context.System.user.accessToken;
        let enqueueIndex = this.attributes['index'];

        let params = {
            TableName: constants.playlistTableName,
            Key: {
                access_token: access_token,
                order: enqueueIndex
            }
        };
        // console.log("playlist numItems query:", JSON.stringify(params));
        let self = this;
        dynamodb.get(params, function (err, data) {
            if (err) {
                console.log("error with playlist query", err, err.stack);
            } else {

                // FIXME: adding the functionality to delete already-played audio assets will introduce a bug where articles that aren't finished will be restarted and
                // the full text will be fetched again, but once the snippet gets to the part of the article where the person stopped last, it'll find the existing unplayed
                // audio assets and will begin playing those, leaving the remaining polly requests for that article queued.
                // Come up with a way to either purge all audio assets for a playlist item when a person pauses playback or search and delete forgotten queued polly requests
                // The first probably makes the most sense (just iterate through numSlices and call the new audioAssets.delete function when playback stops)

                // FIXME: Introduces bug where the playback gets stuck on one audio asset, playing it on repeat
                // TODO: what about in cases where multiple people are listening to the same article? A more extensive (and thought-out) solution may be needed to account for this.

                // FIXME: the first and last audio assets for each article aren't deleted
                (function (data) {
                    setImmediate(function () {
                        console.log("article whose assets to delete: " + JSON.stringify(data));
                        playlist.clearOldAudioAssets(data.Item, function (data) {
                            console.log("audio assets cleared: " + JSON.stringify(data));
                        }, true);
                    });
                })(data);
            }
        });
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
    const tokenValue = parseInt(this.event.request.token);
    return this.attributes['playOrder'].indexOf(tokenValue);
}

function getOffsetInMilliseconds() {
    // Extracting offsetInMilliseconds received in the request.
    return this.event.request.offsetInMilliseconds;
}