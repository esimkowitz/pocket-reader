/* -*- coding: utf-8 -*- */

/*
Copyright 2016-2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
Licensed under the Amazon Software License (the "License"). You may not use this file except in 
compliance with the License. A copy of the License is located at
    http://aws.amazon.com/asl/
or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, 
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific 
language governing permissions and limitations under the License.
*/

/*
The Alexa ASK Intent Validator is designed for medium-complex Intent Schema validation. Need to quickly 
try many different combinations of your utterances ON your devices, this is the tool for you.  

Currently supports English and German. (en-US, de-DE).
 **/

'use strict';

// Use the new Alexa SDK
const Alexa = require('alexa-sdk');

// UPDATEME: Does your skill use Dialog Directives?  If so, update this to true.
const DIALOG_DIRECTIVE_SUPPORT = true;

// Series of strings for language tokenization
const LANGUAGE_STRINGS = {
    'en': {
        'launchRequestResponse': 'Welcome to Pocket Reader! If this is your first time, ask for help.',
        'exit': 'Goodbye.',
        'okay': 'Okay.',
        'received_with': ' received with ',
        'fetching': 'Fetching',
        'reading': 'Reading',
        'articles_from_pocket': 'articles from Pocket',
        'slot': ' slot. ',
        'additionalRequests': 'Is there anything else I can help you with?',
        'slots': ' slots. ',
        'still_listening': "I'm still listening,  Please try another intent or say, stop",
        'received_slots_are': 'Received slots are ',
        'card_title': 'Pocket Reader',
        'error': "I'm sorry, I'm not myself today. Let's start over."
    },
    'de': {
        'launchRequestResponse': 'Launch Request. Gib den nächsten Befehl oder sage Abbruch',
        'exit': 'Auf Wiedersehen.',
        'received_with': ' empfangen mit ',
        'slot': ' Slot. ',
        'slots': ' Slots. ',
        'still_listening': "Ich lausche noch immer. Bitte gebe einen neuen Befehl oder sage Stop.",
        'received_slots_are': 'Empfangene Slots sind ',
        'card_title': 'Pocket Reader'
    }
}

//Set default language to English unless overridden by the skill request.
let LANGUAGE = LANGUAGE_STRINGS.en;

//The various handlers for interpreting the interaction model from the skill
const handlers = {

    // Launch request - "open skillName" - keep the session open until the user requests to exit
    'LaunchRequest': function () {
        this.attributes['dialogSession'] = true;
        this.emit(':ask', LANGUAGE.launchRequestResponse, LANGUAGE.launchRequestResponse);
    },
    // End the Session
    'SessionEndedRequest': function () {
        this.emit('AMAZON.StopIntent');
    },
    'AMAZON.StopIntent': function () {
        this.emit(':tell', LANGUAGE.exit);
    },
    'AMAZON.CancelIntent': function () {
        this.emit(':ask', `${LANGUAGE.okay} ${LANGUAGE.additionalRequests}`);
    },
    'AMAZON.ExitIntent': function () {
        this.emit('AMAZON.StopIntent');
    },
    'FetchArticleIntent': function () {
        // this.emit('Reflect', this.event.request);
        let request = this.event.request;

        // If dialog directive support is enabled AND it exists and it is not in "completed" status, delegate back to the interaction model
        if (DIALOG_DIRECTIVE_SUPPORT && request.dialogState && request.dialogState !== 'COMPLETED') {
            this.emit(':delegate');
        } else {
            this.emit('FetchArticle');
        }
    },
    'FetchArticle': function () {

        if (alexa.event.session.user.accessToken == undefined) {

            alexa.emit(':tellWithLinkAccountCard',
                'to start using this skill, please use the companion app to authenticate on Amazon');
            return;

        }
        let slots = this.event.request.intent.slots;

        let fetch_data = {
            'qualifier': 'newest',
            'number': 1
        };

        if (slots) {
            for (let i in slots) {
                //Check if there is a value in a given slot
                switch (slots[i].name) {
                    case 'Qualifier':
                        {
                            if (slots[i].resolutions) {
                                let resolutions = slots[i].resolutions.resolutionsPerAuthority;
                                if (resolutions.length > 0) {
                                    if (resolutions[0].values.length > 0) {
                                        fetch_data['qualifier'] = resolutions[0].values[0].value.id;
                                    }
                                }
                            }
                            break;
                        }
                    case 'Number':
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
            let responseText = `${LANGUAGE.reading} ${fetch_data['number']} ${fetch_data['qualifier']} ${LANGUAGE.articles_from_pocket}. `;
            let cardInfo = `${LANGUAGE.reading} ${fetch_data['number']} ${fetch_data['qualifier']} ${LANGUAGE.articles_from_pocket}. `;

            this.attributes['intentOutput'] = cardInfo;

            // Determine if we are going to end the session or keep it in dialog mode.  When used in dialog mode we "ask" 
            // as we are expecting another question to come through.  When used in OneShot mode we "tell" and end the session.
            if (this.attributes['dialogSession']) {
                this.emit(':askWithCard', responseText, LANGUAGE.still_listening, LANGUAGE.card_title, cardInfo);
            } else {
                this.emit(':tellWithCard', responseText, LANGUAGE.card_title, cardInfo);
            }
        } else {
            this.emit(':ask', `${LANGUAGE.error} ${LANGUAGE.additionalRequests}`);
        }

    },

    // The main handler - here we simply take the inbound Alexa request, parse out the intent and slots, then return back 
    // to the user, either as a dialog
    'Unhandled': function () {
        // this.emit('Reflect', this.event.request);
        let request = this.event.request;

        // If dialog directive support is enabled AND it exists and it is not in "completed" status, delegate back to the interaction model
        if (DIALOG_DIRECTIVE_SUPPORT && request.dialogState && request.dialogState !== 'COMPLETED') {
            this.emit(':delegate');
        } else {
            let intentInfo = parseIntentsAndSlotsFromEvent(request);
            this.attributes['intentOutput'] = intentInfo.cardInfo;

            // Determine if we are going to end the session or keep it in dialog mode.  When used in dialog mode we "ask" 
            // as we are expecting another question to come through.  When used in OneShot mode we "tell" and end the session.
            if (this.attributes['dialogSession']) {
                this.emit(':askWithCard', intentInfo.response, LANGUAGE.still_listening, LANGUAGE.card_title, intentInfo.cardInfo);
            } else {
                this.emit(':tellWithCard', intentInfo.response, LANGUAGE.card_title, intentInfo.cardInfo);
            }
        }
    }

};

/**
 * Parses the collected event info from Alexa into a friendlier TTS response and 
 * creates a card response with Intent/Slot info
 */
function parseIntentsAndSlotsFromEvent(request) {
    //Cleanse the request intent name
    let intentName = request.intent.name.replace(/[^a-zA-Z0-9]/g, " ");

    let LANGUAGE = {};
    //use German language if the locale is Germany
    switch (request.locale) {
        case 'de-DE':
            LANGUAGE = LANGUAGE_STRINGS.de;
            break;
        default:
            LANGUAGE = LANGUAGE_STRINGS.en;
    }

    let numSlots = 0;
    let slots = request.intent.slots;

    let filledInSlots = {};

    if (slots) {
        for (let i in slots) {
            //Check if there is a value in a given slot
            if (slots[i].value) {
                var id = "no id";
                if (slots[i].resolutions) {
                    var resolutions = slots[i].resolutions.resolutionsPerAuthority;
                    if (resolutions.length > 0) {
                        if (resolutions[0].values.length > 0) {
                            id = resolutions[0].values[0].value.id;
                        }
                    }
                }
                filledInSlots[slots[i].name] = [slots[i].value, id];
                numSlots++;
            }
        }
    }

    let responseText = `${intentName} ${LANGUAGE.received_with} ${numSlots} ${LANGUAGE.slots}`;
    let cardInfo = `${intentName} ${LANGUAGE.received_with} ${numSlots} ${LANGUAGE.slots}`;

    if (filledInSlots > 0) {
        responseText += LANGUAGE.received_slots_are;
    }

    for (let slotName in filledInSlots) {
        responseText += ` ${slotName}, ${filledInSlots[slotName][0]}, ${filledInSlots[slotName][1]}. `;
        cardInfo += `\n${slotName}: ${filledInSlots[slotName][0]}, ${filledInSlots[slotName][1]} `;
    }

    return {
        response: responseText,
        cardInfo: cardInfo
    };
}

exports.handler = (event, context) => {
    console.log(JSON.stringify(event));
    console.log(JSON.stringify(context));
    const alexa = Alexa.handler(event, context);
    alexa.registerHandlers(handlers);
    alexa.execute();
};