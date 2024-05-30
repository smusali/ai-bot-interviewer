// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const { Deepgram } = require("@deepgram/sdk");
const { Twilio } = require("twilio");
const textToSpeech = require("@google-cloud/text-to-speech");
const util = require("util");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
const deepgram = new Deepgram(deepgramApiKey);

const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = new Twilio(twilioAccountSid, twilioAuthToken);

const googleClient = new textToSpeech.TextToSpeechClient();

app.use(express.static("public"));

io.on("connection", (socket) => {
  let stream = null;

  socket.on("startInterview", async () => {
    if (stream !== null) {
      console.log("Deepgram connection already open.");
      return;
    }

    try {
      stream = await deepgram.transcription.live({
        punctuate: true,
      });

      stream.addListener("transcriptReceived", async (transcript) => {
        socket.emit("transcript", transcript);

        console.log("Transcript received:", transcript);

        // Generate synthetic audio response
        const responseText =
          transcript.channel.alternatives[0].transcript ||
          "Hello, please start your interview.";
        const request = {
          input: { text: responseText },
          voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
          audioConfig: { audioEncoding: "LINEAR16" },
        };

        const [response] = await googleClient.synthesizeSpeech(request);
        socket.emit("deepgramAudio", response.audioContent);
      });

      stream.addListener("open", () => {
        console.log("Deepgram connection opened.");
        socket.emit("deepgramConnectionStatus", "open");
      });

      stream.addListener("close", () => {
        console.log("Deepgram connection closed.");
        stream = null;
        socket.emit("deepgramConnectionStatus", "closed");
      });

      stream.addListener("error", (error) => {
        console.error("Deepgram stream error:", error);
        stream = null;
        socket.emit("deepgramConnectionStatus", "error");
      });
    } catch (error) {
      console.error("Error starting Deepgram stream:", error);
      stream = null;
    }
  });

  socket.on("audio", (audioData) => {
    if (stream) {
      try {
        stream.send(audioData);
      } catch (error) {
        console.error("Error sending audio data:", error);
      }
    } else {
      console.error("Deepgram connection not open. Cannot send audio data.");
    }
  });

  socket.on("disconnect", () => {
    if (stream) {
      stream.finish();
      stream = null;
    }
  });
});

app.post("/voice", (req, res) => {
  const response = new twilio.twiml.VoiceResponse();
  response.say(
    "Welcome to the JOBx interview. Please start speaking after the beep."
  );
  response.record({
    transcribe: false,
    playBeep: true,
    timeout: 10,
    trim: "do-not-trim",
  });
  res.type("text/xml");
  res.send(response.toString());
});

server.listen(3000, () => {
  console.log("Server is running on port 3000");
});
