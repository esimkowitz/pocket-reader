/* -*- coding: utf-8 -*- */

/*
Copyright 2017 Evan Simkowitz. All Rights Reserved.
Licensed under the Apache License 2.0 (the "License"). You may not use this file except in 
compliance with the License. A copy of the License is located at
    http://www.apache.org/licenses/
or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, 
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific 
language governing permissions and limitations under the License.
*/

/*

Currently supports English. (en-US).
 **/

'use strict';

// Use the new Alexa SDK
const Alexa = require('alexa-sdk');

var constants = require('./constants');
var stateHandlers = require('./stateHandlers');
var audioEventHandlers = require('./audioEventHandlers');

exports.handler = function (event, context, callback) {
    var alexa = Alexa.handler(event, context);
    alexa.appId = constants.appId;
    alexa.dynamoDBTableName = constants.dynamoDBTableName;
    alexa.registerHandlers(
        stateHandlers.startModeIntentHandlers,
        stateHandlers.playModeIntentHandlers,
        stateHandlers.remoteControllerHandlers,
        stateHandlers.resumeDecisionModeIntentHandlers,
        stateHandlers.fetchModeIntentHandlers,
        audioEventHandlers
    );
    alexa.execute();
};

