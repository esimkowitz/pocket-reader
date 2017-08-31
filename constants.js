"use strict";

module.exports = Object.freeze({

    // App-ID. TODO: set to your own Skill App ID from the developer portal.
    appId: 'amzn1.ask.skill.31ac82a3-b8c0-4a68-87de-475fede46eb9',
    appTitle: 'Pocket Reader for Alexa',

    //  DynamoDB Table name
    dynamoDBTableName: 'PocketReader',
    pollyQueueTableName: 'pocket-reader-polly-queue',
    audioAssetQueueTableName: 'pocket-reader-asset-queue',
    audioAssetTableName: 'pocket-reader-assets',
    playlistTableName: 'pocket-reader-playlist',

    /*
     *  States:
     *  START_MODE : Welcome state when the audio list has not begun.
     *  PLAY_MODE :  When a playlist is being played. Does not imply only active play.
     *               It remains in the state as long as the playlist is not finished.
     *  FETCH_MODE:  When the user makes a request for articles from Pocket.
     *  RESUME_DECISION_MODE : When a user invokes the skill in PLAY_MODE with a LaunchRequest,
     *                         the skill provides an option to resume from last position, or to start over the playlist.
     */
    states: {
        START_MODE: '',
        PLAY_MODE: '_PLAY_MODE',
        FETCH_MODE: '_FETCH_MODE',
        RESUME_DECISION_MODE: '_RESUME_DECISION_MODE'
    },
    audioAssetBucket: "pocket-reader-audio-files",
    audioAssetFormat: 'mp3'
});