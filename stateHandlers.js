'use strict';

const Alexa = require('alexa-sdk');
const constants = require('./constants');
const requests = require('./requests');
const playlist = require('./playlist');
const RandomString = require('./RandomString');

let AWS = require('aws-sdk');
AWS.config.update({
    region: 'us-east-1'
});


const DIALOG_DIRECTIVE_SUPPORT = true;

// Series of strings for language tokenization
const LANGUAGE_STRINGS = {
    'en': {
        'launchRequestResponse': 'Welcome to Pocket Reader! If this is your first time, ask for help.',
        'exit': 'Goodbye.',
        'okay': 'Okay.',
        'link_account': 'To start using this skill, please use the Alexa app to link your Pocket account.',
        'received_with': ' received with ',
        'fetching': 'Fetching',
        'reading': 'Reading',
        'reading_following': 'Reading the following articles from Pocket',
        'articles_from_pocket': 'articles from Pocket',
        'slot': ' slot. ',
        'additionalRequests': 'Is there anything else I can help you with?',
        'slots': ' slots. ',
        'still_listening': "I'm still listening,  Please try another intent or say, stop",
        'received_slots_are': 'Received slots are ',
        'card_title': 'Pocket Reader',
        'error': "I'm sorry, I'm not myself today. Let's start over."
    }
}

//Set default language to English unless overridden by the skill request.
let LANGUAGE = LANGUAGE_STRINGS.en;

let stateHandlers = {
    fetchModeIntentHandlers: Alexa.CreateStateHandler(constants.states.FETCH_MODE, {
        'FetchArticleIntent': function () {
            let request = this.event.request;

            //  Change state to FETCH_MODE
            this.handler.state = constants.states.FETCH_MODE;
            // If dialog directive support is enabled AND it exists and it is not in "completed" status, delegate back to the interaction model
            if (DIALOG_DIRECTIVE_SUPPORT && request.dialogState && request.dialogState !== 'COMPLETED') {
                this.emit(':delegate');
            } else {
                this.emitWithState('FetchArticle');
            }
        },
        'PlayAudio': function () {
            //  Change state to START_MODE
            this.handler.state = constants.states.START_MODE;
            this.emitWithState('PlayAudio');
        },
        'FetchArticle': function () {
            let access_token = this.event.session.user.accessToken;
            console.log("FetchArticle Request");

            // If the access_token isn't set, the user must link their Pocket account to Alexa's services.
            if (access_token === undefined) {

                this.emit(':tellWithLinkAccountCard',
                    LANGUAGE.link_account);
                return;

            }

            this.attributes['playlist'] = [];

            let slots = this.event.request.intent.slots;

            let fetch_data = {
                'qualifier': 'newest',
                'number': 1
            };

            if (slots) {
                for (let i in slots) {
                    //Check if there is a value in a given slot
                    switch (slots[i].name) {
                        case 'Qualifier': // Obtain the resolved qualifier (either 'oldest' or 'newest')
                            {
                                if (slots[i].resolutions) {
                                    let resolutions = slots[i].resolutions.resolutionsPerAuthority;
                                    if (resolutions.length > 0) {
                                        if (resolutions[0].values.length > 0) {
                                            fetch_data['qualifier'] = resolutions[0].values[0].value.name;
                                        }
                                    }
                                }
                                break;
                            }
                        case 'Number': // Obtain the number of articles desired
                            {
                                {
                                    fetch_data['number'] = Number(slots[i].value ? slots[i].value : 1);
                                }
                                break;
                            }
                        default:
                            {
                                break;
                            }
                    }

                }

                // Retrieve the n newest|oldest articles using Pocket's Retrieve API
                let request_data = {
                    "consumer_key": process.env.POCKET_CONSUMER_KEY,
                    "access_token": access_token,
                    "count": fetch_data['number'],
                    "detailType": "simple",
                    "sort": fetch_data['qualifier'],
                    "contentType": "article"
                };
                let url = 'https://getpocket.com/v3/get';
                let self = this;
                requests.makeRequest(url, request_data, function (err, res) {
                    let article_list = {},
                        sort_id_list = {};
                    let count = 0;
                    if (!err) {
                        if (res.status && res.complete) {
                            article_list = res.list;
                            for (let key in article_list) {
                                sort_id_list[article_list[key].sort_id] = key;
                                count++;
                            }
                        }
                    }

                    // Gather the requested articles, either from the cached audio files or
                    // from Pocket
                    if (!err && res.status && res.complete) {
                        // For debugging purposes, set count to 1.
                        // count = 1;
                        for (let i = 0; i < count; ++i) {
                            let article = article_list[sort_id_list[String(i)]];

                            // Create a random string of characters to use as an additional key, 
                            // allowing an article to be played back by multiple users at the 
                            // same time without interference.
                            const random_string = RandomString.newString(constants.randomStringLength);
                            const key = `${random_string}-${article.resolved_id}`;

                            self.attributes['playlist'].push({
                                access_token: access_token,
                                order: self.attributes['playlist'].length,
                                article_key: key,
                                article_url: article.resolved_url,
                                curr_index: 0
                            });
                        }
                        self.emit('PlayAudio');
                    }
                });
            } else {
                this.emit(':ask', `${LANGUAGE.error} ${LANGUAGE.additionalRequests}`);
            }
        },
        'Unhandled': function () {
            var message = 'Sorry, I could not understand. Please say, play the audio, to begin the audio.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    }),
    startModeIntentHandlers: Alexa.CreateStateHandler(constants.states.START_MODE, {
        /*
         *  All Intent Handlers for state : START_MODE
         */
        'FetchArticleIntent': function () {
            let request = this.event.request;

            //  Change state to FETCH_MODE
            this.handler.state = constants.states.FETCH_MODE;
            // If dialog directive support is enabled AND it exists and it is not in "completed" status, delegate back to the interaction model
            if (DIALOG_DIRECTIVE_SUPPORT && request.dialogState && request.dialogState !== 'COMPLETED') {
                this.emit(':delegate');
            } else {
                this.emitWithState('FetchArticle');
            }
        },
        'LaunchRequest': function () {
            // If the access_token isn't set, the user must link their Pocket account to Alexa's services.
            if (this.event.session.user.accessToken === undefined) {

                this.emit(':tellWithLinkAccountCard',
                    LANGUAGE.link_account);
                return;

            }
            this.emit(':ask', LANGUAGE.launchRequestResponse, LANGUAGE.launchRequestResponse);
        },
        'PlayAudio': function () {
            //  Change state to START_MODE
            this.handler.state = constants.states.START_MODE;
            if (!this.attributes['playOrder'] || this.attributes['playOrder'].length !== this.attributes['playlist'].length) {

                // Initialize Attributes if undefined.
                this.attributes['playOrder'] = Array.apply(null, {
                    length: this.attributes['playlist'].length
                }).map(Number.call, Number);
                this.attributes['index'] = 0;
                this.attributes['offsetInMilliseconds'] = 0;
                this.attributes['loop'] = false;
                this.attributes['shuffle'] = false;
                this.attributes['playbackIndexChanged'] = true;
            }
            controller.play.call(this);

        },
        'AMAZON.HelpIntent': function () {
            var message = 'Welcome to the AWS Podcast. You can say, play the audio, to begin the podcast.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        },
        'AMAZON.StopIntent': function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'AMAZON.CancelIntent': function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'SessionEndedRequest': function () {
            // No session ended logic
        },
        'Unhandled': function () {
            var message = 'Sorry, I could not understand. Please say, play the audio, to begin the audio.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    }),
    playModeIntentHandlers: Alexa.CreateStateHandler(constants.states.PLAY_MODE, {
        /*
         *  All Intent Handlers for state : PLAY_MODE
         */
        'FetchArticleIntent': function () {
            // this.emit('Reflect', this.event.request);
            let request = this.event.request;

            //  Change state to FETCH_MODE
            this.handler.state = constants.states.FETCH_MODE;
            // If dialog directive support is enabled AND it exists and it is not in "completed" status, delegate back to the interaction model
            if (DIALOG_DIRECTIVE_SUPPORT && request.dialogState && request.dialogState !== 'COMPLETED') {
                this.emit(':delegate');
            } else {
                this.emitWithState('FetchArticle');
            }
        },
        'LaunchRequest': function () {
            /*
             *  Session resumed in PLAY_MODE STATE.
             *  If playback had finished during last session :
             *      Give welcome message.
             *      Change state to START_STATE to restrict user inputs.
             *  Else :
             *      Ask user if he/she wants to resume from last position.
             *      Change state to RESUME_DECISION_MODE
             */

            // If the access_token isn't set, the user must link their Pocket account to Alexa's services.
            if (this.event.session.user.accessToken === undefined) {
                this.emit(':tellWithLinkAccountCard',
                    LANGUAGE.link_account);
                return;
            }
            this.attributes['dialogSession'] = true;
            if (this.attributes['playbackFinished']) {
                this.handler.state = constants.states.START_MODE;
                let message = LANGUAGE.launchRequestResponse;
                let reprompt = LANGUAGE.launchRequestResponse;
                this.emit(':ask', message, reprompt);
            } else {
                this.handler.state = constants.states.RESUME_DECISION_MODE;
                this.emitWithState('LaunchRequest');
            }
        },
        'PlayAudio': function () {
            controller.play.call(this)
        },
        'AMAZON.NextIntent': function () {
            controller.playNext.call(this)
        },
        'AMAZON.PreviousIntent': function () {
            controller.playPrevious.call(this)
        },
        'AMAZON.PauseIntent': function () {
            controller.stop.call(this)
        },
        'AMAZON.StopIntent': function () {
            controller.stop.call(this)
        },
        'AMAZON.CancelIntent': function () {
            controller.stop.call(this)
        },
        'AMAZON.ResumeIntent': function () {
            controller.play.call(this)
        },
        'AMAZON.LoopOnIntent': function () {
            controller.loopOn.call(this)
        },
        'AMAZON.LoopOffIntent': function () {
            controller.loopOff.call(this)
        },
        'AMAZON.ShuffleOnIntent': function () {
            controller.shuffleOn.call(this)
        },
        'AMAZON.ShuffleOffIntent': function () {
            controller.shuffleOff.call(this)
        },
        'AMAZON.StartOverIntent': function () {
            controller.startOver.call(this)
        },
        'AMAZON.HelpIntent': function () {
            // This will called while audio is playing and a user says "ask <invocation_name> for help"
            var message = 'You are listening to Pocket Reader. ' +
                'At any time, you can say Pause to pause the audio and Resume to resume.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        },
        'SessionEndedRequest': function () {
            // No session ended logic
        },
        'Unhandled': function () {
            var message = 'Sorry, I could not understand. ' +
                'At any time, you can say Pause to pause the audio and Resume to resume.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    }),
    remoteControllerHandlers: Alexa.CreateStateHandler(constants.states.PLAY_MODE, {
        /*
         *  All Requests are received using a Remote Control. Calling corresponding handlers for each of them.
         */
        'PlayCommandIssued': function () {
            controller.play.call(this)
        },
        'PauseCommandIssued': function () {
            controller.stop.call(this)
        },
        'NextCommandIssued': function () {
            controller.playNext.call(this)
        },
        'PreviousCommandIssued': function () {
            controller.playPrevious.call(this)
        }
    }),
    resumeDecisionModeIntentHandlers: Alexa.CreateStateHandler(constants.states.RESUME_DECISION_MODE, {
        /*
         *  All Intent Handlers for state : RESUME_DECISION_MODE
         */
        'LaunchRequest': function () {
            let index = this.attributes['playOrder'][this.attributes['index']];
            var message = 'You were listening to ' + this.attributes['playlist'][index].title +
                ' Would you like to resume?';
            var reprompt = 'You can say yes to resume or no to play from the top.';
            this.response.speak(message).listen(reprompt);
            this.emit(':responseReady');
        },
        'AMAZON.YesIntent': function () {
            controller.play.call(this)
        },
        'AMAZON.NoIntent': function () {
            controller.reset.call(this)
        },
        'AMAZON.HelpIntent': function () {
            let index = this.attributes['playOrder'][this.attributes['index']];
            var message = 'You were listening to ' + this.attributes['playlist'][index].title +
                ' Would you like to resume?';
            var reprompt = 'You can say yes to resume or no to play from the top.';
            this.response.speak(message).listen(reprompt);
            this.emit(':responseReady');
        },
        'AMAZON.StopIntent': function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'AMAZON.CancelIntent': function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'SessionEndedRequest': function () {
            // No session ended logic
        },
        'Unhandled': function () {
            var message = 'Sorry, this is not a valid command. Please say help to hear what you can say.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    })
};

module.exports = stateHandlers;

var controller = function () {
    return {
        play: function () {
            /*
             *  Using the function to begin playing audio when:
             *      Play Audio intent invoked.
             *      Resuming audio when stopped/paused.
             *      Next/Previous commands issued.
             */
            this.handler.state = constants.states.PLAY_MODE;

            if (this.attributes['playbackFinished']) {
                // Reset to top of the playlist when reached end.
                this.attributes['index'] = 0;
                this.attributes['offsetInMilliseconds'] = 0;
                this.attributes['playbackIndexChanged'] = true;
                this.attributes['playbackFinished'] = false;
            }

            const token = String(this.attributes['playOrder'][this.attributes['index']]);
            const playBehavior = 'REPLACE_ALL';
            // const access_token = this.event.session.user.accessToken;
            const curr_index = this.attributes['playOrder'][this.attributes['index']];
            let self = this;
            playlist.getNextAudioAsset(this.attributes['playlist'][curr_index], function (audioAsset) {
                console.log("audioAsset", JSON.stringify(audioAsset));
                const offsetInMilliseconds = self.attributes['offsetInMilliseconds'];
                // Since play behavior is REPLACE_ALL, enqueuedToken attribute need to be set to null.
                self.attributes['enqueuedToken'] = null;

                if (canThrowCard.call(self)) {
                    const cardTitle = constants.appTitle;
                    const cardContent = 'Playing ' + audioAsset.title;
                    self.response.cardRenderer(cardTitle, cardContent, null);
                }

                self.response.audioPlayerPlay(playBehavior, audioAsset.url, token, null, offsetInMilliseconds);
                self.emit(':responseReady');
            });
        },
        stop: function () {
            /*
             *  Issuing AudioPlayer.Stop directive to stop the audio.
             *  Attributes already stored when AudioPlayer.Stopped request received.
             */
            this.response.audioPlayerStop();
            this.emit(':responseReady');
        },
        // TODO: Update playNext to play next article, not next audio asset.
        playNext: function () {
            /*
             *  Called when AMAZON.NextIntent or PlaybackController.NextCommandIssued is invoked.
             *  Index is computed using token stored when AudioPlayer.PlaybackStopped command is received.
             *  If reached at the end of the playlist, choose behavior based on "loop" flag.
             */
            let index = this.attributes['index'];
            index += 1;
            // Check for last audio file.
            if (index === this.attributes['playlist'].length) {
                if (this.attributes['loop']) {
                    index = 0;
                } else {
                    // Reached at the end. Thus reset state to start mode and stop playing.
                    this.handler.state = constants.states.START_MODE;

                    var message = 'You have reached at the end of the playlist.';
                    this.response.speak(message).audioPlayerStop();
                    return this.emit(':responseReady');
                }
            }
            // Set values to attributes.
            this.attributes['index'] = index;
            this.attributes['offsetInMilliseconds'] = 0;
            this.attributes['playbackIndexChanged'] = true;

            controller.play.call(this);
        },
        // TODO: Update playPrevious to play previous article, not previous audio asset.
        playPrevious: function () {
            /*
             *  Called when AMAZON.PreviousIntent or PlaybackController.PreviousCommandIssued is invoked.
             *  Index is computed using token stored when AudioPlayer.PlaybackStopped command is received.
             *  If reached at the end of the playlist, choose behavior based on "loop" flag.
             */
            let index = this.attributes['index'];
            index -= 1;
            // Check for last audio file.
            if (index === -1) {
                if (this.attributes['loop']) {
                    index = this.attributes['playlist'].length - 1;
                } else {
                    // Reached at the end. Thus reset state to start mode and stop playing.
                    this.handler.state = constants.states.START_MODE;

                    var message = 'You have reached at the start of the playlist.';
                    this.response.speak(message).audioPlayerStop();
                    return this.emit(':responseReady');
                }
            }
            // Set values to attributes.
            this.attributes['index'] = index;
            this.attributes['offsetInMilliseconds'] = 0;
            this.attributes['playbackIndexChanged'] = true;

            controller.play.call(this);
        },
        loopOn: function () {
            // Turn on loop play.
            this.attributes['loop'] = true;
            var message = 'Loop turned on.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        loopOff: function () {
            // Turn off looping
            this.attributes['loop'] = false;
            var message = 'Loop turned off.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        shuffleOn: function () {
            // Turn on shuffle play.
            this.attributes['shuffle'] = true;
            shuffleOrder((newOrder) => {
                // Play order have been shuffled. Re-initializing indices and playing first song in shuffled order.
                this.attributes['playOrder'] = newOrder;
                this.attributes['index'] = 0;
                this.attributes['offsetInMilliseconds'] = 0;
                this.attributes['playbackIndexChanged'] = true;
                controller.play.call(this);
            });
        },
        shuffleOff: function () {
            // Turn off shuffle play. 
            if (this.attributes['shuffle']) {
                this.attributes['shuffle'] = false;
                // Although changing index, no change in audio file being played as the change is to account for reordering playOrder
                this.attributes['index'] = this.attributes['playOrder'][this.attributes['index']];
                this.attributes['playOrder'] = Array.apply(null, {
                    length: this.attributes['playlist'].length
                }).map(Number.call, Number);
            }
            controller.play.call(this);
        },
        // TODO: Change startOver to start at the beginning of the article, not the audioAsset.
        startOver: function () {
            // Start over the current audio file.
            this.attributes['offsetInMilliseconds'] = 0;
            controller.play.call(this);
        },
        reset: function () {
            // Reset to top of the playlist.
            this.attributes['index'] = 0;
            this.attributes['offsetInMilliseconds'] = 0;
            this.attributes['playbackIndexChanged'] = true;
            controller.play.call(this);
        }
    }
}();

function canThrowCard() {
    /*
     * To determine when can a card should be inserted in the response.
     * In response to a PlaybackController Request (remote control events) we cannot issue a card,
     * Thus adding restriction of request type being "IntentRequest".
     */
    if (this.event.request.type === 'IntentRequest' && this.attributes['playbackIndexChanged']) {
        this.attributes['playbackIndexChanged'] = false;
        return true;
    } else {
        return false;
    }
}

function shuffleOrder(callback) {
    // Algorithm : Fisher-Yates shuffle
    // let access_token = this.event.session.user.accessToken;
    // let params = {
    //     TableName: constants.playlistTableName,
    //     KeyConditionExpression: "#token = :access_token",
    //     ExpressionAttributeNames: {
    //         "#token": "access_token"
    //     },
    //     ExpressionAttributeValues: {
    //         ":access_token": access_token
    //     },
    //     Select: "COUNT"
    // };
    // console.log("database query:", params);
    // let self = this;
    // dynamodb.query(params, function (err, data) {
    //     if (err) {
    //         console.log(err, err.stack);
    //     } else {
    var array = Array.apply(null, {
        length: this.attributes['playlist'].length
    }).map(Number.call, Number);
    var currentIndex = this.attributes['playlist'].length;
    var temp, randomIndex;

    while (currentIndex >= 1) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;
        temp = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temp;
    }
    callback(array);
    //     }
    // });
}