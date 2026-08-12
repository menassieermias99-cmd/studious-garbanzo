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

//State variables

let screenStream = null;
let webcamStream = null;
let audioContext = null;
let audioDestination = null;

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let timerInterval = null;
let secondsElapsed = 0;

// update record button based on actvie streams

function updateRecordButtonState() {
  const hasActiveSource = screenStream !== null || webcamStream !== null;
  if (!isRecording) {
    btnRecord.disabled = !hasActiveSource;
  }
}

//1. Share screen stream (with audio fallback)

btnScreen.addEventListener("click", async () => {
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    rawScreenVideo.srcObject = null;
    btnScreen.textContent = "🖥️ Share Screen";
    statusBadge.textContent = webcamStream ? "Webcam Active" : "Ready";
    updateRecordButtonState();
    return;
  }

  try {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: 60 },
        audio: true,
      });
    } catch (audioErr) {
      console.warn("Screen audio fallback to video-only.", audioErr);
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: 60 },
      });
    }

    rawScreenVideo.srcObject = screenStream;
    btnScreen.textContent = "🖥️ Stop Sharing Screen";
    statusBadge.textContent = "Screen Active";
    updateRecordButtonState();

    screenStream.getVideoTracks()[0].onended = () => {
      screenStream = null;
      rawScreenVideo.srcObject = null;
      btnScreen.textContent = "🖥️ Share Screen";
      statusBadge.textContent = webcamStream ? "Webcam Active" : "Screen Ended";
      updateRecordButtonState();
    };
  } catch (error) {
    console.error("Error sharing screen: ", error);
    statusBadge.textContent = "Screen Canceled";
  }
});

//2.  Toggle webcam stream
btnWebcam.addEventListener("click", async () => {
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
    rawWebcamVideo.srcObject = null;
    btnWebcam.textContent = "📷 Toggle webcam";
    statusBadge.textContent = screenStream ? "Screen Active" : "Ready";
    updateRecordButtonState();
  } else {
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });

      rawWebcamVideo.srcObject = webcamStream;
      btnWebcam.textContent = "📷 Turn off webcam";
      statusBadge.textContent = "Webcam active";
      updateRecordButtonState();
    } catch (error) {
      console.error("Error accessing webcam: ", error);
    }
  }
});

// 3. Canvas Compositor render loop

function renderStudioCanvas() {
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const hasScreen = screenStream && rawScreenVideo.readyState >= 2;
  const hasWebcam = webcamStream && rawWebcamVideo.readyState >= 2;

  if (hasScreen) {
    ctx.drawImage(rawScreenVideo, 0, 0, canvas.width, canvas.height);

    if (hasWebcam) {
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

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, pipWidth, pipHeight, 20);
      ctx.clip();
      ctx.drawImage(rawWebcamVideo, x, y, pipWidth, pipHeight);
      ctx.restore();

      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(x, y, pipWidth, pipHeight, 20);
      ctx.stroke();
    }
  } else if (hasWebcam) {
    ctx.drawImage(rawWebcamVideo, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.save();
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      'Click "Share Screen" or "Toggle Web cam" to Begin',
      canvas.width / 2,
      canvas.height / 2,
    );
    ctx.restore();
  }

  // draw custom watermark text
  const text = watermarkInput.value.trim();

  if (text) {
    ctx.save();
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    ctx.fillText(text, 40, 60);
    ctx.restore();
  }

  requestAnimationFrame(renderStudioCanvas);
}

// Start Rendering
requestAnimationFrame(renderStudioCanvas);

//4. Web Audio Mixer
async function setupAudioMixer() {
  if (audioContext) {
    await audioContext.close();
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  audioDestination = audioContext.createMediaStreamDestination();

  if (screenStream && screenStream.getAudioTracks().length > 0) {
    const screenSource = audioContext.createMediaStreamSource(screenStream);
    screenSource.connect(audioDestination);
  }

  if (webcamStream && webcamStream.getAudioTracks().length > 0) {
    const micSource = audioContext.createMediaStreamSource(webcamStream);
    micSource.connect(audioDestination);
  }
}

// 5. Start Recording
btnRecord.addEventListener("click", async () => {
  if (!screenStream && !webcamStream) return;

  recordedChunks = [];
  await setupAudioMixer();

  const canvasStream = canvas.captureStream(60);

  const combinedTracks = [
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ];

  const combinedStream = new MediaStream(combinedTracks);

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : "video/webm";

  mediaRecorder = new MediaRecorder(combinedStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });

    if (previewPlayer.src) {
      URL.revokeObjectURL(previewPlayer.src);
    }

    const videoURL = URL.createObjectURL(blob);
    previewPlayer.src = videoURL;
    downloadLink.href = videoURL;
    outputSection.classList.remove("hidden");
  };

  mediaRecorder.start(1000);
  isRecording = true;
  btnRecord.disabled = true;
  btnStop.disabled = false;
  statusBadge.textContent = "🔴 Recording ...";

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

//6. Stop Recording
btnStop.addEventListener("click", () => {
  if (!mediaRecorder || !isRecording) return;

  mediaRecorder.stop();
  isRecording = false;
  clearInterval(timerInterval);

  btnStop.disabled = true;
  updateRecordButtonState();

  statusBadge.textContent = "Recording Saved";
});
