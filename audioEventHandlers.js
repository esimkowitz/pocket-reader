'use strict';

const Alexa = require('alexa-sdk');
const constants = require('./constants');
const playlist = require('./playlist');

let AWS = require('aws-sdk');
AWS.config.update({
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
        this.attributes['index'] = this.attributes['nextPlaylistIndex'];
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

        this.attributes['token'] = getToken.call(this);
        this.attributes['index'] = getIndex.call(this);
      
        this.emit(':saveState', true);
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
        let enqueueIndex = this.attributes['index'];
        let article = this.attributes['playlist'][enqueueIndex];
        console.log("Current article: " + JSON.stringify(article));
        if (article.curr_index >= article.numSlices) {
            enqueueIndex += 1;
        }
        console.log("enqueueIndex", enqueueIndex, "data.Count", this.attributes['playlist'].length);
        if (enqueueIndex >= this.attributes['playlist'].length) {
            if (this.attributes['loop']) {
                // Enqueueing the first item since looping is enabled.
                enqueueIndex = 0;
            } else {
                // Nothing to enqueue since reached end of the list and looping is disabled.
                return this.context.succeed(true);
            }
        }
        // Setting attributes to indicate item is enqueued.
        this.attributes['enqueuedToken'] = `${this.attributes['playOrder'][enqueueIndex]}-${article.curr_index}`;
        this.attributes['nextArticleIndex'] = article.curr_index;
        this.attributes['nextPlaylistIndex'] = enqueueIndex;

        let enqueueToken = this.attributes['enqueuedToken'];
        const playBehavior = 'ENQUEUE';
        let self = this;
        playlist.getNextAudioAsset(self.attributes['playlist'][enqueueIndex], function (audioAsset) {
            console.log("audioAsset", JSON.stringify(audioAsset));
            let expectedPreviousToken = self.attributes['token'];
            let offsetInMilliseconds = 0;

            self.response.audioPlayerPlay(playBehavior, audioAsset.url, enqueueToken, expectedPreviousToken, offsetInMilliseconds);
            console.log("response:", JSON.stringify(self.response));
            self.emit(':responseReady');
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
    const tokenValue = parseInt(this.event.request.token);
    return this.attributes['playOrder'].indexOf(tokenValue);
}

function getOffsetInMilliseconds() {
    // Extracting offsetInMilliseconds received in the request.
    return this.event.request.offsetInMilliseconds;
}