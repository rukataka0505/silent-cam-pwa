const video = document.querySelector("#preview");
const canvas = document.querySelector("#captureCanvas");
const cameraStage = document.querySelector(".camera-stage");
const emptyState = document.querySelector("#emptyState");
const supportText = document.querySelector("#supportText");
const startButton = document.querySelector("#startButton");
const shutterButton = document.querySelector("#shutterButton");
const switchButton = document.querySelector("#switchButton");
const flashButton = document.querySelector("#flashButton");
const flashLabel = document.querySelector("#flashLabel");
const downloadLastButton = document.querySelector("#downloadLastButton");
const latestThumb = document.querySelector("#latestThumb");
const modeButton = document.querySelector("#modeButton");
const galleryPanel = document.querySelector(".gallery-panel");
const galleryList = document.querySelector("#galleryList");
const clearButton = document.querySelector("#clearButton");
const message = document.querySelector("#cameraMessage");
const installStatus = document.querySelector("#installStatus span");
const zoomButtons = [...document.querySelectorAll(".zoom-option")];
const reviewDialog = document.querySelector("#reviewDialog");
const reviewImage = document.querySelector("#reviewImage");
const closeReviewButton = document.querySelector("#closeReviewButton");
const downloadReviewLink = document.querySelector("#downloadReviewLink");

const STORAGE_KEY = "silent-cam-shots";
const AUTO_SHARE_KEY = "silent-cam-auto-share";
const MAX_SHOTS = 24;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const HIGH_QUALITY_VIDEO_WIDTH = 4032;
const HIGH_QUALITY_VIDEO_HEIGHT = 3024;
const JPEG_QUALITY = 0.95;
const ZOOM_EPSILON = 0.005;

let stream = null;
let facingMode = "environment";
let flashEnabled = false;
let captures = loadCaptures();
let currentReviewCapture = null;
let autoShareAfterCapture = localStorage.getItem(AUTO_SHARE_KEY) === "true";
let currentZoom = 1;
let currentDigitalZoom = 1;
let zoomCapabilities = null;
let activeNativeZoom = 1;
let queuedNativeZoom = null;
let isApplyingNativeZoom = false;
let zoomSessionId = 0;
let pinchStartDistance = 0;
let pinchStartZoom = 1;
let lastMessageTimer = null;

const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

init();

function init() {
  renderInstallStatus();
  renderGallery();
  renderSupportHint();
  renderAutoShareMode();

  startButton.addEventListener("click", startCamera);
  shutterButton.addEventListener("click", capturePhoto);
  switchButton.addEventListener("click", switchCamera);
  flashButton.addEventListener("click", toggleTorch);
  downloadLastButton.addEventListener("click", saveLatestToPhotos);
  latestThumb.addEventListener("click", openLatest);
  clearButton.addEventListener("click", clearCaptures);
  closeReviewButton.addEventListener("click", () => reviewDialog.close());
  modeButton.addEventListener("click", toggleAutoShareMode);
  downloadReviewLink.addEventListener("click", saveReviewToPhotos);

  zoomButtons.forEach((button) => {
    button.addEventListener("click", () => setZoom(Number(button.dataset.zoom), button));
  });

  cameraStage.addEventListener("touchstart", startPinchZoom, { passive: false });
  cameraStage.addEventListener("touchmove", updatePinchZoom, { passive: false });
  cameraStage.addEventListener("touchend", finishPinchZoom);
  cameraStage.addEventListener("touchcancel", finishPinchZoom);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && stream) {
      video.play().catch(() => {});
    }
  });
}

function renderSupportHint() {
  if (!navigator.mediaDevices?.getUserMedia) {
    supportText.textContent = "このブラウザではカメラAPIが使えません。Safariの最新版で開いてください。";
    startButton.disabled = true;
    return;
  }

  if (!window.isSecureContext) {
    supportText.textContent = "iPhoneで使うにはHTTPS配信が必要です。localhost以外のHTTPではカメラを起動できません。";
  }
}

function renderInstallStatus() {
  installStatus.textContent = isStandalone ? "ホーム画面で起動中" : "ホーム画面対応";
}

async function startCamera() {
  try {
    stopCamera();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: HIGH_QUALITY_VIDEO_WIDTH },
        height: { ideal: HIGH_QUALITY_VIDEO_HEIGHT },
        resizeMode: { ideal: "none" },
      },
    });

    video.srcObject = stream;
    await video.play();
    emptyState.classList.add("hidden");
    configureZoom();
    setZoom(currentZoom, null, { announce: false });
    showMessage("カメラ起動");
    syncTorchAvailability();
  } catch (error) {
    showError(cameraErrorMessage(error));
  }
}

function stopCamera() {
  resetZoomTrackState();
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
  stream = null;
}

async function switchCamera() {
  facingMode = facingMode === "environment" ? "user" : "environment";
  showMessage(facingMode === "environment" ? "背面カメラ" : "前面カメラ");
  await startCamera();
}

async function toggleTorch() {
  const track = getVideoTrack();
  const capabilities = track?.getCapabilities?.();

  if (!track || !capabilities?.torch) {
    showMessage("このカメラはライト非対応です");
    return;
  }

  flashEnabled = !flashEnabled;

  try {
    await track.applyConstraints({ advanced: [{ torch: flashEnabled }] });
    flashLabel.textContent = flashEnabled ? "オン" : "オフ";
    showMessage(flashEnabled ? "ライトオン" : "ライトオフ");
  } catch {
    flashEnabled = false;
    flashLabel.textContent = "オフ";
    showError("ライトを切り替えられませんでした");
  }
}

function syncTorchAvailability() {
  const capabilities = getVideoTrack()?.getCapabilities?.();
  flashButton.disabled = !capabilities?.torch;
  flashLabel.textContent = flashEnabled ? "オン" : "オフ";
}

async function capturePhoto() {
  if (!stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    showError("先にカメラを起動してください");
    return;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  const frame = getVisibleFrame(width, height);
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = frame.outputWidth;
  canvas.height = frame.outputHeight;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.save();
  if (facingMode === "user") {
    context.translate(frame.outputWidth, 0);
    context.scale(-1, 1);
  }
  context.drawImage(
    video,
    frame.sourceX,
    frame.sourceY,
    frame.sourceWidth,
    frame.sourceHeight,
    0,
    0,
    frame.outputWidth,
    frame.outputHeight,
  );
  context.restore();

  const image = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const capture = { id: crypto.randomUUID(), image, createdAt: Date.now() };
  captures = [capture, ...captures].slice(0, MAX_SHOTS);
  saveCaptures();
  renderGallery();
  pulseShutter();

  if (autoShareAfterCapture) {
    await shareCapture(capture, { auto: true });
    return;
  }

  showMessage("撮影しました");
}

function pulseShutter() {
  shutterButton.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(0.94)" },
      { transform: "scale(1)" },
    ],
    { duration: 160, easing: "ease-out" },
  );
}

function renderGallery() {
  galleryPanel.classList.toggle("empty", captures.length === 0);
  latestThumb.innerHTML = "";

  if (!captures.length) {
    latestThumb.innerHTML = "<span>未撮影</span>";
    galleryList.innerHTML = "";
    galleryPanel.classList.remove("open");
    return;
  }

  latestThumb.appendChild(createImage(captures[0].image, "直近の写真"));
  galleryPanel.classList.add("open");

  galleryList.innerHTML = "";
  captures.forEach((capture) => {
    const button = document.createElement("button");
    button.className = "gallery-item";
    button.type = "button";
    button.setAttribute("aria-label", new Date(capture.createdAt).toLocaleString("ja-JP"));
    button.appendChild(createImage(capture.image, "撮影した写真"));
    button.addEventListener("click", () => openReview(capture));
    galleryList.appendChild(button);
  });
}

function createImage(src, alt) {
  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;
  image.loading = "lazy";
  return image;
}

function openLatest() {
  if (!captures.length) {
    showMessage("まだ撮影していません");
    return;
  }
  openReview(captures[0]);
}

function openReview(capture) {
  currentReviewCapture = capture;
  reviewImage.src = capture.image;
  downloadReviewLink.href = capture.image;
  downloadReviewLink.download = filenameFor(capture.createdAt);

  if (typeof reviewDialog.showModal === "function") {
    reviewDialog.showModal();
  } else {
    window.open(capture.image, "_blank", "noopener");
  }
}

async function saveLatestToPhotos() {
  if (!captures.length) {
    showMessage("まだ撮影していません");
    return;
  }

  await shareCapture(captures[0]);
}

async function saveReviewToPhotos(event) {
  event.preventDefault();

  if (!currentReviewCapture) {
    showMessage("保存する写真がありません");
    return;
  }

  await shareCapture(currentReviewCapture);
}

async function shareCapture(capture, options = {}) {
  const file = dataUrlToFile(capture.image, filenameFor(capture.createdAt));
  const shareData = {
    files: [file],
    title: "Silent Cam",
  };

  if (navigator.canShare?.(shareData) && navigator.share) {
    try {
      await navigator.share(shareData);
      showMessage("共有を開きました");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        showMessage("共有を閉じました");
        return;
      }
      showError("写真保存を開けませんでした");
    }
  }

  downloadCapture(capture);
  showMessage(options.auto ? "共有非対応のためファイル保存しました" : "ファイルに保存しました");
}

function downloadCapture(capture) {
  const link = document.createElement("a");
  link.href = capture.image;
  link.download = filenameFor(capture.createdAt);
  link.click();
}

function dataUrlToFile(dataUrl, filename) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], filename, { type: mime });
}

function toggleAutoShareMode() {
  autoShareAfterCapture = !autoShareAfterCapture;
  localStorage.setItem(AUTO_SHARE_KEY, String(autoShareAfterCapture));
  renderAutoShareMode();
  showMessage(autoShareAfterCapture ? "撮影後に写真保存を開きます" : "手動保存にしました");
}

function renderAutoShareMode() {
  modeButton.textContent = autoShareAfterCapture ? "自動" : "手動";
  modeButton.setAttribute("aria-pressed", String(autoShareAfterCapture));
  modeButton.classList.toggle("active", autoShareAfterCapture);
}

function clearCaptures() {
  captures = [];
  localStorage.removeItem(STORAGE_KEY);
  renderGallery();
  showMessage("消去しました");
}

function setZoom(value, activeButton = null, options = {}) {
  currentZoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
  applyZoomState();
  syncZoomButtons(activeButton);

  if (options.announce !== false) {
    showMessage(`${formatZoom(currentZoom)}x`);
  }
}

function configureZoom() {
  zoomSessionId += 1;
  const track = getVideoTrack();
  zoomCapabilities = getTrackZoomCapabilities(track);
  activeNativeZoom = getTrackZoomSetting(track) || MIN_ZOOM;
  queuedNativeZoom = null;
  isApplyingNativeZoom = false;
}

function resetZoomTrackState() {
  zoomSessionId += 1;
  zoomCapabilities = null;
  activeNativeZoom = MIN_ZOOM;
  queuedNativeZoom = null;
  isApplyingNativeZoom = false;
  setPreviewZoom(currentZoom);
}

function applyZoomState() {
  const nativeZoomTarget = getNativeZoomTarget(currentZoom);
  const digitalZoomTarget = nativeZoomTarget > 0 ? currentZoom / nativeZoomTarget : currentZoom;
  setPreviewZoom(digitalZoomTarget);
  queueNativeZoom(nativeZoomTarget);
}

function setPreviewZoom(value) {
  currentDigitalZoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
  document.documentElement.style.setProperty("--camera-zoom", currentDigitalZoom.toFixed(3));
}

function getTrackZoomCapabilities(track) {
  const capabilities = track?.getCapabilities?.();
  const zoom = capabilities?.zoom;

  if (!zoom || typeof zoom.min !== "number" || typeof zoom.max !== "number") {
    return null;
  }

  const min = Math.max(MIN_ZOOM, zoom.min);
  const max = Math.min(MAX_ZOOM, zoom.max);

  if (max <= min) {
    return null;
  }

  return {
    min,
    max,
    step: typeof zoom.step === "number" && zoom.step > 0 ? zoom.step : 0.01,
  };
}

function getTrackZoomSetting(track) {
  const zoom = track?.getSettings?.().zoom;
  return typeof zoom === "number" && Number.isFinite(zoom) ? zoom : null;
}

function getNativeZoomTarget(value) {
  if (!zoomCapabilities) {
    return MIN_ZOOM;
  }

  return normalizeNativeZoom(clamp(value, zoomCapabilities.min, zoomCapabilities.max));
}

function normalizeNativeZoom(value) {
  if (!zoomCapabilities) {
    return MIN_ZOOM;
  }

  const steps = Math.round((value - zoomCapabilities.min) / zoomCapabilities.step);
  const stepped = zoomCapabilities.min + steps * zoomCapabilities.step;
  return Number(clamp(stepped, zoomCapabilities.min, zoomCapabilities.max).toFixed(3));
}

function queueNativeZoom(value) {
  const track = getVideoTrack();

  if (!track || !zoomCapabilities) {
    return;
  }

  const nextZoom = normalizeNativeZoom(value);

  if (Math.abs(nextZoom - activeNativeZoom) < ZOOM_EPSILON && queuedNativeZoom === null) {
    return;
  }

  queuedNativeZoom = nextZoom;

  if (isApplyingNativeZoom) {
    return;
  }

  void flushNativeZoomQueue(zoomSessionId);
}

async function flushNativeZoomQueue(sessionId) {
  isApplyingNativeZoom = true;

  while (sessionId === zoomSessionId && queuedNativeZoom !== null) {
    const nextZoom = queuedNativeZoom;
    queuedNativeZoom = null;
    const track = getVideoTrack();

    if (!track || !zoomCapabilities) {
      break;
    }

    try {
      await track.applyConstraints({ advanced: [{ zoom: nextZoom }] });

      if (sessionId !== zoomSessionId || track !== getVideoTrack()) {
        break;
      }

      activeNativeZoom = nextZoom;
    } catch {
      if (sessionId !== zoomSessionId) {
        break;
      }

      zoomCapabilities = null;
      activeNativeZoom = MIN_ZOOM;
      queuedNativeZoom = null;
      setPreviewZoom(currentZoom);
      break;
    }
  }

  if (sessionId === zoomSessionId) {
    isApplyingNativeZoom = false;
  }
}

function syncZoomButtons(activeButton) {
  const selectedButton = activeButton || nearestZoomButton(currentZoom);
  zoomButtons.forEach((button) => button.classList.toggle("active", button === selectedButton));
}

function nearestZoomButton(value) {
  return zoomButtons.reduce((closest, button) => {
    const buttonDistance = Math.abs(Number(button.dataset.zoom) - value);
    const closestDistance = Math.abs(Number(closest.dataset.zoom) - value);
    return buttonDistance < closestDistance ? button : closest;
  }, zoomButtons[0]);
}

function startPinchZoom(event) {
  if (event.touches.length !== 2 || isInteractiveTarget(event.target)) return;

  event.preventDefault();
  pinchStartDistance = touchDistance(event.touches[0], event.touches[1]);
  pinchStartZoom = currentZoom;
}

function updatePinchZoom(event) {
  if (event.touches.length !== 2 || pinchStartDistance === 0) return;

  event.preventDefault();
  const nextDistance = touchDistance(event.touches[0], event.touches[1]);
  setZoom(pinchStartZoom * (nextDistance / pinchStartDistance), null, { announce: false });
}

function finishPinchZoom(event) {
  if (event.touches.length >= 2 || pinchStartDistance === 0) return;

  pinchStartDistance = 0;
  pinchStartZoom = currentZoom;
  showMessage(`${formatZoom(currentZoom)}x`);
}

function touchDistance(firstTouch, secondTouch) {
  return Math.hypot(firstTouch.clientX - secondTouch.clientX, firstTouch.clientY - secondTouch.clientY);
}

function isInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest("button, a, dialog"));
}

function getVisibleFrame(videoWidth, videoHeight) {
  const stageRect = cameraStage.getBoundingClientRect();
  const targetAspect = stageRect.width > 0 && stageRect.height > 0 ? stageRect.width / stageRect.height : videoWidth / videoHeight;
  const videoAspect = videoWidth / videoHeight;
  let baseWidth = videoWidth;
  let baseHeight = videoHeight;

  if (videoAspect > targetAspect) {
    baseWidth = videoHeight * targetAspect;
  } else {
    baseHeight = videoWidth / targetAspect;
  }

  const outputWidth = Math.max(1, Math.round(baseWidth));
  const outputHeight = Math.max(1, Math.round(baseHeight));
  const sourceWidth = Math.min(videoWidth, Math.max(1, Math.round(baseWidth / currentDigitalZoom)));
  const sourceHeight = Math.min(videoHeight, Math.max(1, Math.round(baseHeight / currentDigitalZoom)));

  return {
    sourceX: Math.round((videoWidth - sourceWidth) / 2),
    sourceY: Math.round((videoHeight - sourceHeight) / 2),
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatZoom(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getVideoTrack() {
  return stream?.getVideoTracks?.()[0] ?? null;
}

function loadCaptures() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCaptures() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(captures));
  } catch {
    showError("端末の保存容量が足りません");
  }
}

function filenameFor(timestamp) {
  const stamp = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  return `silent-cam-${stamp}.jpg`;
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") return "カメラ権限が許可されていません";
  if (error?.name === "NotFoundError") return "カメラが見つかりません";
  if (!window.isSecureContext) return "HTTPSで開くとカメラを起動できます";
  return "カメラを起動できませんでした";
}

function showMessage(text) {
  message.textContent = text;
  message.className = "camera-message visible";
  clearTimeout(lastMessageTimer);
  lastMessageTimer = window.setTimeout(() => {
    message.className = "camera-message";
    message.textContent = "";
  }, 1800);
}

function showError(text) {
  message.textContent = text;
  message.className = "camera-message visible error";
  clearTimeout(lastMessageTimer);
  lastMessageTimer = window.setTimeout(() => {
    message.className = "camera-message";
    message.textContent = "";
  }, 2600);
}
