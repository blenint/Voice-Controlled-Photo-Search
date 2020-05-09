import React from 'react';
import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import InputBase from '@material-ui/core/InputBase';
import SearchIcon from '@material-ui/icons/Search';
import IconButton from '@material-ui/core/IconButton';
import Tooltip from '@material-ui/core/Tooltip';
import MicIcon from '@material-ui/icons/Mic';
import MicOffIcon from '@material-ui/icons/MicOff';
import Upload from "./upload/Upload";
import useStyles from './App-Style.js';
import './App.css';
import axios from 'axios';
const audioUtils        = require('./audioUtils');  // for encoding audio data as PCM
const crypto            = require('crypto'); // tot sign our pre-signed URL
const v4                = require('./aws-signature-v4'); // to generate our pre-signed URL
const marshaller        = require("@aws-sdk/eventstream-marshaller"); // for converting binary event stream messages to and from JSON
const util_utf8_node    = require("@aws-sdk/util-utf8-node"); // utilities for encoding and decoding UTF8
const mic               = require('microphone-stream'); // collect microphone input as a stream of raw bytes

// var apigClientFactory = require('./apigClient').default;

// our converter between binary event streams messages and JSON
const eventStreamMarshaller = new marshaller.EventStreamMarshaller(util_utf8_node.toUtf8, util_utf8_node.fromUtf8);

// our global variables for managing state
let languageCode;
let region;
let sampleRate;
let inputSampleRate;
let transcription = "";
let socket;
let micStream;
let socketError = false;
let transcribeException = false;

export default function App() {
  const classes = useStyles();
  const [query, setQuery] = React.useState();
  const [imagesList, setImagesList] = React.useState([]);
  const [defaultSearch, setDefaultSearch] = React.useState("");

  const startRecording = async () => {

    setLanguage();
    setRegion();

    // first we get the microphone input from the browser (as a promise)...
    window.navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true
        })
        // ...then we convert the mic stream to binary event stream messages when the promise resolves 
        .then(streamAudioToWebSocket) 
        .catch(function (error) {
            showError('There was an error streaming your audio to Amazon Transcribe. Please try again.');
          
        });
  }

  let streamAudioToWebSocket = function (userMediaStream) {
    //let's get the mic input from the browser, via the microphone-stream module
    micStream = new mic();

    micStream.on("format", function(data) {
        inputSampleRate = data.sampleRate;
    });

    micStream.setStream(userMediaStream);

    // Pre-signed URLs are a way to authenticate a request (or WebSocket connection, in this case)
    // via Query Parameters. Learn more: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    let url = createPresignedUrl();

    //open up our WebSocket connection
    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    // when we get audio data from the mic, send it to the WebSocket if possible
    socket.onopen = function() {
        micStream.on('data', function(rawAudioChunk) {
            // the audio stream is raw audio bytes. Transcribe expects PCM with additional metadata, encoded as binary
            let binary = convertAudioToBinaryMessage(rawAudioChunk);

            if (socket.readyState === socket.OPEN)
                socket.send(binary);
        }
    )};

    // handle messages, errors, and close events
    wireSocketEvents();
}

function setLanguage() {
  languageCode = "en-US";
  sampleRate = 44100;

}

function setRegion() {
    region = "us-east-1"
}

function wireSocketEvents() {
    // handle inbound messages from Amazon Transcribe
    socket.onmessage = function (message) {
        //convert the binary event stream message to JSON
        let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(message.data));
        let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body));
        if (messageWrapper.headers[":message-type"].value === "event") {
            handleEventStreamMessage(messageBody);
        }
        else {
            transcribeException = true;
            showError(messageBody.Message);
          
        }
    };

    socket.onerror = function () {
        socketError = true;
        showError('WebSocket connection error. Try again.');
      
    };
    
    socket.onclose = function (closeEvent) {
        micStream.stop();
        
        // the close event immediately follows the error event; only handle one.
        if (!socketError && !transcribeException) {
            if (closeEvent.code !== 1000) {
                showError('</i><strong>Streaming Exception</strong><br>' + closeEvent.reason);
            }
          
        }
    };
}

let handleEventStreamMessage = function (messageJson) {
    let results = messageJson.Transcript.Results;

    if (results.length > 0) {
        if (results[0].Alternatives.length > 0) {
            let transcript = results[0].Alternatives[0].Transcript;
            // fix encoding for accented characters
            transcript = decodeURIComponent(escape(transcript));

            // if this transcript segment is final, add it to the overall transcription
            if (!results[0].IsPartial) {

                transcription = transcript;
            }
        }
    }
}

let closeSocket = function () {
    if (socket.readyState === socket.OPEN) {
        micStream.stop();
        // Send an empty frame so that Transcribe initiates a closure of the WebSocket after submitting all transcripts
        let emptyMessage = getAudioEventMessage(Buffer.from(new Buffer([])));
        let emptyBuffer = eventStreamMarshaller.marshall(emptyMessage);
        socket.send(emptyBuffer);
    }
}

  const stopRecording = async () => {

    closeSocket();
    console.log("Transcription: ", transcription)
    handleVoiceSearch(transcription)
    setDefaultSearch(transcript)

  }

  function showError(message) {
    alert(message);
}

function convertAudioToBinaryMessage(audioChunk) {
    let raw = mic.toRaw(audioChunk);

    if (raw == null)
        return;

    // downsample and convert the raw audio bytes to PCM
    let downsampledBuffer = audioUtils.downsampleBuffer(raw, inputSampleRate, sampleRate);
    let pcmEncodedBuffer = audioUtils.pcmEncode(downsampledBuffer);

    // add the right JSON headers and structure to the message
    let audioEventMessage = getAudioEventMessage(Buffer.from(pcmEncodedBuffer));

    //convert the JSON object + headers into a binary event stream message
    let binary = eventStreamMarshaller.marshall(audioEventMessage);

    return binary;
}

function getAudioEventMessage(buffer) {
    // wrap the audio data in a JSON envelope
    return {
        headers: {
            ':message-type': {
                type: 'string',
                value: 'event'
            },
            ':event-type': {
                type: 'string',
                value: 'AudioEvent'
            }
        },
        body: buffer
    };
}

function createPresignedUrl() {
    let endpoint = "transcribestreaming." + region + ".amazonaws.com:8443";

    // get a preauthenticated URL that we can use to establish our WebSocket
    return v4.createPresignedURL(
        'GET',
        endpoint,
        '/stream-transcription-websocket',
        'transcribe',
        crypto.createHash('sha256').update('', 'utf8').digest('hex'), {
            'key': 'AKIAZRDXPGY5FA2AW4WE',
            'secret': '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',
            'protocol': 'wss',
            'expires': 15,
            'region': region,
            'query': "language-code=" + languageCode + "&media-encoding=pcm&sample-rate=" + sampleRate
        }
    );
}

  const handleTextSearch = (event) => { 

    axios({
      method: 'get',
      url: 'https://gf1tccyqza.execute-api.us-east-1.amazonaws.com/Dev/search?q='+query
    })
      .then(function(response) {
        console.log(response.data)
      if (response.data === "No Results") {
        alert("No results!")
      }
      else {
        setImagesList(response.data)
      }
       
      
    })
    .catch((result) => {
        console.error(result);
      });

    
  }

  const handleVoiceSearch = (voiceQuery) => {
    axios({
      method: 'get',
      url: 'https://gf1tccyqza.execute-api.us-east-1.amazonaws.com/Dev/search?q='+voiceQuery
    })
      .then(function(response) {
        if (response.data === "No Results") {
          alert("No results!")
        }
        else {
          setImagesList(response.data)
        }
    })
    .catch((result) => {
        console.error(result);
      });
}

let images = imagesList.map(image => {
  return <img key={image} src={image} alt="" className="images" />
});

  return (
    <div className="App">
    <div className={classes.grow}>
      <AppBar position="static">
        <Toolbar className={classes.toolbar}>
          <Typography className={classes.title} variant="h6" noWrap>
            Photo Album
          </Typography>
          <div className={classes.search}>
            <InputBase
              placeholder="Search…"
              classes={{
                root: classes.inputRoot,
                input: classes.inputInput,
              }}
              inputProps={{ 'aria-label': 'search' }}
              defaultValue=defaultSearch
              onChange={event=>{                               
              setQuery(event.target.value)            
        }}
            />
          <Tooltip title = "Search">
            <IconButton className={classes.icons} aria-label="search" onClick={handleTextSearch}>
              <SearchIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title = "Voice Search">
            <IconButton className={classes.icons} aria-label="search" onClick={startRecording}>
              <MicIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title = "Stop recording">
            <IconButton className={classes.icons} aria-label="search" onClick={stopRecording}>
              <MicOffIcon />
            </IconButton>
          </Tooltip>
          </div>
          <div className={classes.grow} />
        </Toolbar>
      </AppBar>
      <div className="Card">
        <Upload />
        <div className="imagesDiv"> { images } </div>      
      </div>
    </div>
    </div>
  );
}