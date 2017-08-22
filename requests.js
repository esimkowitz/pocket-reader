// This function makes XML HTTP requests to the specified URL containing the specified data in the
// specified format. The response is handled by the specified callback function.

var XMLHttpRequest1 = require("xmlhttprequest").XMLHttpRequest;

function makeRequest(url, data, callback, method = "JSON") {
    let dataStr = "";
    switch (method) {
        case "FORM":
            {
                for (let name in data) {
                    dataStr += name + '=' + data[name] + '&';
                }
                dataStr = dataStr.substr(0, dataStr.length - 1);
                break;
            }
        default: // case "JSON":
            {
                dataStr = JSON.stringify(data);
                console.log("request body: " + dataStr);
                break;
            }
    }

    let XHR = new XMLHttpRequest1();

    // Define what happens on successful data submission
    XHR.addEventListener('load', function (e) {
        // console.log('response: ' + XHR.responseText);
        if (XHR.status !== 200) {
            callback(true, XHR.responseText);
        } else {
            callback(false, JSON.parse(XHR.responseText));
        }
    });

    // Define what happens in case of error
    XHR.addEventListener('error', function (e) {
        callback(e, XHR.response);
    });

    // Set up our request    
    XHR.open('POST', url);
    let content_type = (method === "FORM") ? "application/x-www-form-urlencoded" : "application/json";
    XHR.setRequestHeader('Content-Type', `${content_type}; charset=UTF8`);
    XHR.setRequestHeader('X-Accept', `${content_type}; charset=UTF8`);
    XHR.send(dataStr);
}

exports.makeRequest = makeRequest;