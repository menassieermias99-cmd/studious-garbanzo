//DOM elements
const btnScreen = document.getElementById("btnScreen");
const btnWebcam = document.getElementById("btnWebcam");
const btnRecord = document.getElementById("btnRecord");
const btnStop = document.getElementById("btnStop");

const watermarkInput = document.getElementById("watermarkInput");
const pipPositionSelect = document.getElementById("pipPosition");
const timerDisplay = document.getElementById("timer");
const statusBadge = document.getElementById("statusBadge");

const canvas = document.getElementById("studioCanvas");
const ctx = canvas.getContext("2d");
const rawScreenVideo = document.getElementById("rawScreenVideo");
const rawWebcamVideo = document.getElementById("rawWebcamVideo");

const outputSection = document.getElementById("outputSection");
const previewPlayer = document.getElementById("previewPlayer");
const downloadLink = document.getElementById("downloadLink");

// State variables

let screenStream = null;
let webcamStream = null;
let audioContext = null;
let audioDestination = null;

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let timerInterval = null;
let secondsElapsed = 0;

// 1. share screen stream

btnScreen.addEventListener("click", async () => {
  try {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: 60 },
        audio: true,
      });
    } catch (audioErr) {
      console.warn(
        "Screen audio capture failed/unsupported, Falling back to video only.",
        audioErr,
      );
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: 60 },
      });
    }

    rawScreenVideo.srcObject = screenStream;
    statusBadge.textContent = "Screen Active";

    btnRecord.disabled = false;

    //Auto Stop if user stops sharing via browser UI
    screenStream.getVideoTracks()[0].onended = () => {
      screenStream = null;
      statusBadge.textContent = "Screen Ended";
      btnRecord.disabled = true;
    };
  } catch (error) {
    console.error("Error sharing screen: ", error);
    statusBadge.textContent = "Screen Cancelled";
  }
});

// 2. toggle webcam stream
btnWebcam.addEventListener("click", async () => {
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
    rawWebcamVideo.srcObject = null;
    btnWebcam.textContent = "📷 Toggle Webcam";
  } else {
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true,
      });

      rawWebcamVideo.srcObject = webcamStream;
      btnWebcam.textContent = "📷 Turn Off Webcam";
    } catch (err) {
      console.error("Error accessing webcam: ", err);
    }
  }
});

// 3. Canvas Compositor Render Loop
function renderStudioCanvas() {
  //Clear canvas background
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  //Draw Main Screen Video Feed
  if (rawScreenVideo.readyState >= 2) {
    ctx.drawImage(rawScreenVideo, 0, 0, canvas.width, canvas.height);
  } else {
    //Placeholder text if screen not ready
    ctx.save();
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      'Click "Share Screen" to Begin Studio Preview',
      canvas.width / 2,
      canvas.height / 2,
    );
  }

  //Draw Picture-in-Picture Webcam Feed(if active)
  if (webcamStream && rawWebcamVideo.readyState >= 2) {
    const pipWidth = 360;
    const pipHeight = 270;
    const margin = 40;
    let x = canvas.width - pipWidth - margin;
    let y = canvas.height - pipHeight - margin;

    const pos = pipPositionSelect.value;
    if (pos === "top-left") {
      x = margin;
      y = margin;
    } else if (pos === "top-right") {
      x = canvas.width - pipWidth - margin;
      y = margin;
    } else if (pos === "bottom-left") {
      x = margin;
      y = canvas.height - pipHeight - margin;
    } else if (pos === "bottom-right") {
      x = canvas.width - pipWidth - margin;
      y = canvas.height - pipHeight - margin;
    }

    //Render Circular / Rounded Mask for Webcam
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, pipWidth, pipHeight, 20);
    ctx.clip();
    ctx.drawImage(rawWebcamVideo, x, y, pipWidth, pipHeight);
    ctx.restore();

    //Stroke Border
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, pipWidth, pipHeight, 20);
    ctx.stroke();
  }
  // Draw Custom Watermark text
  const text = watermarkInput.value.trim();
  if (text) {
    ctx.save();
    ctx.font = "bold 32px sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    ctx.fillText(text, 40, 60);
    ctx.restore();
  }

  requestAnimationFrame(renderStudioCanvas);
}

// Start 60FPS canvas rendering
requestAnimationFrame(renderStudioCanvas);

//4. Web Audio Mixer
async function setupAudioMixer() {
  if (audioContext) {
    await audioContext.close();
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  audioDestination = audioContext.createMediaStreamDestination();

  // Add screen audio if present
  if (screenStream && screenStream.getAudioTracks().length > 0) {
    const screenSource = audioContext.createMediaStreamSource(screenStream);
    screenSource.connect(audioDestination);
  }

  // Add Microphone Audio if present
  if (webcamStream && webcamStream.getAudioTracks().length > 0) {
    const micSource = audioContext.createMediaStreamSource(webcamStream);
    micSource.connect(audioDestination);
  }
}

//5. Start Recording
btnRecord.addEventListener("click", () => {
  if (!screenStream) return;

  recordedChunks = [];
  setupAudioMixer();

  // Combine Canvas Video Stream + Mixed Audio Stream
  const canvasStream = canvas.captureStream(60);

  const combinedTracks = [
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ];

  const combinedStream = new MediaStream(combinedTracks);

  mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType: "video/webm;codecs=vp9,opus",
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });

    const videoUrl = URL.createObjectURL(blob);
    previewPlayer.src = videoUrl;
    downloadLink.href = videoUrl;
    outputSection.classList.remove("hidden");
  };

  mediaRecorder.start(1000); //Record in 1s chunks
  isRecording = true;
  btnRecord.disabled = true;
  btnStop.disabled = false;
  statusBadge.textContent = "🔴 Recording ...";

  // start timer
  secondsElapsed = 0;
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const hrs = String(Math.floor(secondsElapsed / 3600)).padStart(2, "0");
    const mins = String(Math.floor((secondsElapsed % 3600) / 60)).padStart(
      2,
      "0",
    );
    const secs = String(secondsElapsed % 60).padStart(2, "0");
    timerDisplay.textContent = `${hrs}:${mins}:${secs}`;
  }, 1000);
});

// 6. stop recording
btnStop.addEventListener("click", () => {
  if (!mediaRecorder || !isRecording) return;

  mediaRecorder.stop();
  isRecording = false;
  clearInterval(timerInterval);

  btnRecord.disabled = false;
  btnStop.disabled = true;

  statusBadge.textContent = "Recording Saved";
});
