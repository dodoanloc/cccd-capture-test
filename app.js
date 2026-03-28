const state = {
  stream: null,
  useEnvironmentCamera: true,
  captureStep: 'front',
  frontImage: '',
  backImage: '',
  qrImage: '',
  qrText: '',
  records: [],
  loadedRecordId: null,
  autoCaptureEnabled: true,
  autoCaptureCooldown: false,
  frameCheckTimer: null,
  ocrWorker: null,
  db: null,
};

const DB_NAME = 'cccd_capture_db';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const stepLabels = { front: 'Mặt trước', back: 'Mặt sau', qr: 'QR' };

const els = {
  video: document.getElementById('video'),
  captureCanvas: document.getElementById('captureCanvas'),
  captureHint: document.getElementById('captureHint'),
  autoCaptureText: document.getElementById('autoCaptureText'),
  frontPreview: document.getElementById('frontPreview'),
  backPreview: document.getElementById('backPreview'),
  qrPreview: document.getElementById('qrPreview'),
  statusBanner: document.getElementById('statusBanner'),
  searchInput: document.getElementById('searchInput'),
  recordsTableBody: document.getElementById('recordsTableBody'),
};

const formIds = {
  fullName: 'fullName',
  idNumber: 'idNumber',
  oldIdNumber: 'oldIdNumber',
  birthDate: 'birthDate',
  gender: 'gender',
  issueDate: 'issueDate',
  issuePlace: 'issuePlace',
  permanentAddress: 'permanentAddress',
  currentAddress: 'currentAddress',
};

function setBanner(message, type = 'info') {
  els.statusBanner.className = `status-banner ${type}`;
  els.statusBanner.textContent = message;
}

function updateStepUI() {
  document.querySelectorAll('.step-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.step === state.captureStep);
  });
  els.captureHint.textContent = stepLabels[state.captureStep];
  els.autoCaptureText.textContent = state.captureStep === 'qr'
    ? 'QR dùng để bổ sung số CMND cũ nếu có'
    : 'Tự động chụp khi thẻ rõ, sáng và đứng yên';
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('fullName', 'fullName', { unique: false });
        store.createIndex('idNumber', 'idNumber', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getStore(mode = 'readonly') {
  return state.db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function idbRequestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadRecordsFromDb() {
  const store = getStore('readonly');
  const records = await idbRequestToPromise(store.getAll());
  state.records = (records || []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function saveRecordToDb(record) {
  const store = getStore('readwrite');
  await idbRequestToPromise(store.put(record));
}

async function deleteRecordFromDb(id) {
  const store = getStore('readwrite');
  await idbRequestToPromise(store.delete(id));
}

async function startCamera() {
  try {
    stopCamera();
    const constraints = {
      video: {
        facingMode: state.useEnvironmentCamera ? { ideal: 'environment' } : 'user',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    els.video.srcObject = state.stream;
    await els.video.play();
    setBanner('Camera đã sẵn sàng. Đưa thẻ vào khung, app sẽ cố tự chụp khi đủ rõ.', 'success');
    startAutoCaptureLoop();
  } catch (error) {
    console.error(error);
    setBanner('Không bật được camera. Có thể dùng tính năng tải ảnh lên.', 'error');
  }
}

function stopCamera() {
  if (state.frameCheckTimer) {
    clearInterval(state.frameCheckTimer);
    state.frameCheckTimer = null;
  }
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
  }
}

function startAutoCaptureLoop() {
  if (state.frameCheckTimer) clearInterval(state.frameCheckTimer);
  state.frameCheckTimer = setInterval(() => {
    if (!state.autoCaptureEnabled || state.autoCaptureCooldown) return;
    if (!els.video.videoWidth || !els.video.videoHeight) return;
    checkFrameReadiness();
  }, 850);
}

function checkFrameReadiness() {
  const canvas = els.captureCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = 540;
  canvas.height = 340;
  ctx.drawImage(els.video, 0, 0, canvas.width, canvas.height);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let brightnessAccumulator = 0;
  let gradientScore = 0;

  for (let i = 0; i < data.length; i += 4 * 10) {
    brightnessAccumulator += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }

  for (let y = 2; y < height - 2; y += 3) {
    for (let x = 2; x < width - 2; x += 3) {
      const idx = (y * width + x) * 4;
      const c = data[idx];
      const r = data[idx + 4];
      const b = data[idx + width * 4];
      gradientScore += Math.abs(c - r) + Math.abs(c - b);
    }
  }

  const brightness = brightnessAccumulator / (data.length / (4 * 10));
  const sharpEnough = gradientScore > 320000;
  const lightOkay = brightness > 75 && brightness < 225;

  if (sharpEnough && lightOkay) {
    state.autoCaptureCooldown = true;
    captureFrame(true);
    setTimeout(() => { state.autoCaptureCooldown = false; }, 1800);
  }
}

function nextStep() {
  if (state.captureStep === 'front') state.captureStep = 'back';
  else if (state.captureStep === 'back') state.captureStep = 'qr';
  updateStepUI();
}

async function preprocessImage(dataUrl, mode = 'text') {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxWidth = 1800;
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const contrastBoost = avg > 140 ? 255 : avg < 90 ? 0 : avg;
        data[i] = contrastBoost;
        data[i + 1] = contrastBoost;
        data[i + 2] = contrastBoost;
        if (mode === 'qr') {
          data[i] = avg > 150 ? 255 : 0;
          data[i + 1] = avg > 150 ? 255 : 0;
          data[i + 2] = avg > 150 ? 255 : 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.96));
    };
    img.src = dataUrl;
  });
}

async function captureFrame(auto = false) {
  if (!els.video.videoWidth || !els.video.videoHeight) {
    setBanner('Camera chưa có hình.', 'error');
    return;
  }

  const canvas = els.captureCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = els.video.videoWidth;
  canvas.height = els.video.videoHeight;
  ctx.drawImage(els.video, 0, 0, canvas.width, canvas.height);
  const rawDataUrl = canvas.toDataURL('image/jpeg', 0.95);

  if (state.captureStep === 'front') {
    state.frontImage = rawDataUrl;
    els.frontPreview.src = rawDataUrl;
    setBanner(auto ? 'Đã tự chụp mặt trước. Đang OCR...' : 'Đã chụp mặt trước. Đang OCR...', 'success');
    const processed = await preprocessImage(rawDataUrl, 'text');
    runOcr('front', processed);
    nextStep();
    return;
  }

  if (state.captureStep === 'back') {
    state.backImage = rawDataUrl;
    els.backPreview.src = rawDataUrl;
    setBanner(auto ? 'Đã tự chụp mặt sau. Đang OCR...' : 'Đã chụp mặt sau. Đang OCR...', 'success');
    const processed = await preprocessImage(rawDataUrl, 'text');
    runOcr('back', processed);
    nextStep();
    return;
  }

  state.qrImage = rawDataUrl;
  els.qrPreview.src = rawDataUrl;
  setBanner('Đã chụp QR. Đang đọc QR để lấy số CMND cũ nếu có...', 'info');
  const processedQr = await preprocessImage(rawDataUrl, 'qr');
  readQrFromDataUrl(processedQr);
}

async function getWorker() {
  if (!state.ocrWorker) {
    state.ocrWorker = await Tesseract.createWorker('vie+eng');
  }
  return state.ocrWorker;
}

async function runOcr(side, imageDataUrl) {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(imageDataUrl);
    const text = normalizeOcrText(data.text || '');
    if (side === 'front') parseFrontText(text);
    else parseBackText(text);
  } catch (error) {
    console.error(error);
    setBanner('OCR chưa đọc tốt. Anh/chị có thể chụp lại hoặc chỉnh tay.', 'error');
  }
}

function normalizeOcrText(text) {
  return text
    .replace(/[|]/g, 'I')
    .replace(/CCCD/g, 'CĂN CƯỚC')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parseFrontText(text) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const upperLines = lines.filter(line => /^[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ\s]{6,}$/.test(line));
  const probableName = upperLines.find(line => !/VIỆT NAM|CĂN CƯỚC|IDENTITY|CARD/i.test(line));
  const idMatch = text.match(/\b\d{12}\b/);
  const birthMatch = text.match(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/);
  const genderMatch = text.match(/\bNam\b|\bNữ\b/i);
  const issuePlaceMatch = text.match(/Cục[^\n]+TTXH|Cục Cảnh sát[^\n]+/i);

  assignParsedFields({
    fullName: probableName ? toTitleCase(probableName) : '',
    idNumber: idMatch?.[0] || '',
    birthDate: birthMatch ? normalizeDateString(birthMatch[0]) : '',
    gender: genderMatch ? normalizeGender(genderMatch[0]) : '',
    issuePlace: issuePlaceMatch ? cleanupIssuePlace(issuePlaceMatch[0]) : '',
  }, false);

  setBanner('Đã nhận dạng mặt trước. Tiếp tục chụp mặt sau.', 'success');
}

function parseBackText(text) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const merged = lines.join(' ');
  const issueDateMatch = merged.match(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/);

  const permanentAddress = extractAddress(lines, [/thường trú/i, /noi thuong tru/i]);
  const currentAddress = extractAddress(lines, [/nơi ở hiện tại/i, /hiện tại/i, /noi o hien tai/i]) || permanentAddress;

  assignParsedFields({
    issueDate: issueDateMatch ? normalizeDateString(issueDateMatch[0]) : '',
    permanentAddress,
    currentAddress,
  }, false);

  setBanner('Đã nhận dạng mặt sau. Bước QR chỉ để bổ sung số CMND cũ nếu có.', 'success');
}

function extractAddress(lines, patterns) {
  const idx = lines.findIndex(line => patterns.some(regex => regex.test(line)));
  if (idx >= 0) {
    const slice = lines.slice(idx + 1, idx + 4).join(' ').trim();
    if (slice) return cleanupAddress(slice);
  }
  const addressLike = lines.filter(line => /xã|phường|thị trấn|huyện|quận|tỉnh|thành phố/i.test(line));
  return addressLike.length ? cleanupAddress(addressLike.slice(0, 2).join(', ')) : '';
}

function cleanupAddress(value) {
  return value.replace(/^[,:;\-\s]+/, '').replace(/\s{2,}/g, ' ').trim();
}

function cleanupIssuePlace(value) {
  return value.replace(/\s{2,}/g, ' ').trim();
}

function readQrFromDataUrl(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR(imageData.data, canvas.width, canvas.height);

    if (!result) {
      setBanner('Chưa đọc được QR. Không sao, dữ liệu chính vẫn lấy từ ảnh trước/sau.', 'error');
      return;
    }

    state.qrText = result.data;
    parseVietnamIdQr(result.data);
    setBanner('Đã đọc QR. Đã bổ sung số CMND cũ nếu QR có chứa thông tin đó.', 'success');
  };
  img.src = dataUrl;
}

function parseVietnamIdQr(raw) {
  const cleaned = raw.trim();
  const pipeParts = cleaned.split('|');
  if (pipeParts.length >= 2) {
    const idNumberFromQr = pipeParts[0] || '';
    const oldId = pipeParts[1] || '';
    assignParsedFields({ idNumber: idNumberFromQr, oldIdNumber: oldId }, true);
    return;
  }
  const cmndMatch = cleaned.match(/\b\d{9}\b/);
  if (cmndMatch) assignParsedFields({ oldIdNumber: cmndMatch[0] }, true);
}

function assignParsedFields(data, preferOverwrite = false) {
  Object.entries(data).forEach(([key, value]) => {
    if (!formIds[key] || !value) return;
    const el = document.getElementById(formIds[key]);
    if (preferOverwrite || !el.value.trim()) el.value = value.trim();
  });
}

function normalizeGender(value) {
  const v = value.toLowerCase();
  if (v.includes('nam')) return 'Nam';
  if (v.includes('nữ') || v.includes('nu')) return 'Nữ';
  return value;
}

function normalizeDateString(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 8) return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4,8)}`;
  return value;
}

function toTitleCase(value) {
  return value.toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
}

function getFormData() {
  return Object.fromEntries(Object.entries(formIds).map(([key, id]) => [key, document.getElementById(id).value.trim()]));
}

function validateRecord(data) {
  if (!data.fullName) return 'Chưa có họ tên';
  if (!data.idNumber) return 'Chưa có số CCCD';
  if (!state.frontImage) return 'Chưa có ảnh mặt trước';
  if (!state.backImage) return 'Chưa có ảnh mặt sau';
  return '';
}

async function saveRecord() {
  const formData = getFormData();
  const error = validateRecord(formData);
  if (error) {
    setBanner(error, 'error');
    return;
  }

  const existing = state.loadedRecordId ? state.records.find(r => r.id === state.loadedRecordId) : null;
  const record = {
    id: state.loadedRecordId || crypto.randomUUID(),
    ...formData,
    qrText: state.qrText,
    frontImage: state.frontImage,
    backImage: state.backImage,
    qrImage: state.qrImage,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveRecordToDb(record);
  await loadRecordsFromDb();
  renderRecords();
  setBanner('Đã lưu hồ sơ vào IndexedDB trên thiết bị.', 'success');
  resetFlow(false);
}

function renderRecords() {
  const query = els.searchInput.value.trim().toLowerCase();
  const filtered = state.records.filter(record => {
    if (!query) return true;
    return [record.fullName, record.idNumber, record.permanentAddress, record.currentAddress, record.oldIdNumber]
      .join(' ').toLowerCase().includes(query);
  });

  if (!filtered.length) {
    els.recordsTableBody.innerHTML = '<div class="record-card-item"><div class="record-address">Chưa có hồ sơ nào.</div></div>';
    return;
  }

  const template = document.getElementById('recordCardTemplate');
  els.recordsTableBody.innerHTML = '';
  filtered.forEach(record => {
    const node = template.content.cloneNode(true);
    node.querySelector('.record-name').textContent = record.fullName || 'Chưa có tên';
    node.querySelector('.record-meta').textContent = `${record.idNumber || ''} • ${record.birthDate || ''} • ${record.gender || ''}`;
    node.querySelector('.record-address').textContent = record.permanentAddress || record.currentAddress || 'Chưa có địa chỉ';
    node.querySelector('.action-open').onclick = () => loadRecord(record.id);
    node.querySelector('.action-copy').onclick = () => copyRecord(record.id);
    node.querySelector('.action-print').onclick = () => printRecord(record.id);
    node.querySelector('.action-delete').onclick = () => deleteRecord(record.id);
    els.recordsTableBody.appendChild(node);
  });
}

function loadRecord(id) {
  const record = state.records.find(r => r.id === id);
  if (!record) return;
  state.loadedRecordId = id;
  Object.entries(formIds).forEach(([key, elId]) => {
    document.getElementById(elId).value = record[key] || '';
  });
  state.frontImage = record.frontImage || '';
  state.backImage = record.backImage || '';
  state.qrImage = record.qrImage || '';
  state.qrText = record.qrText || '';
  els.frontPreview.src = state.frontImage;
  els.backPreview.src = state.backImage;
  els.qrPreview.src = state.qrImage;
  setBanner(`Đã mở hồ sơ ${record.fullName}.`, 'info');
}

async function copyRecord(id) {
  const record = state.records.find(r => r.id === id);
  if (!record) return;
  const text = [
    `Họ và tên: ${record.fullName}`,
    `Số CCCD: ${record.idNumber}`,
    `Số CMND cũ: ${record.oldIdNumber || ''}`,
    `Ngày sinh: ${record.birthDate || ''}`,
    `Giới tính: ${record.gender || ''}`,
    `Địa chỉ thường trú: ${record.permanentAddress || ''}`,
    `Địa chỉ hiện tại: ${record.currentAddress || ''}`,
    `Ngày cấp: ${record.issueDate || ''}`,
    `Nơi cấp: ${record.issuePlace || ''}`,
  ].join('\n');
  await navigator.clipboard.writeText(text);
  setBanner('Đã copy thông tin hồ sơ.', 'success');
}

async function copyAllCurrent() {
  const data = getFormData();
  const text = [
    `Họ và tên: ${data.fullName}`,
    `Số CCCD: ${data.idNumber}`,
    `Số CMND cũ: ${data.oldIdNumber}`,
    `Ngày sinh: ${data.birthDate}`,
    `Giới tính: ${data.gender}`,
    `Địa chỉ thường trú: ${data.permanentAddress}`,
    `Địa chỉ hiện tại: ${data.currentAddress}`,
    `Ngày cấp: ${data.issueDate}`,
    `Nơi cấp: ${data.issuePlace}`,
  ].join('\n');
  await navigator.clipboard.writeText(text);
  setBanner('Đã copy toàn bộ thông tin hiện tại.', 'success');
}

async function deleteRecord(id) {
  const record = state.records.find(r => r.id === id);
  if (!record) return;
  if (!confirm(`Xóa hồ sơ ${record.fullName}?`)) return;
  await deleteRecordFromDb(id);
  await loadRecordsFromDb();
  renderRecords();
  setBanner('Đã xóa hồ sơ khỏi IndexedDB.', 'success');
}

function printRecord(id) {
  const record = state.records.find(r => r.id === id);
  if (!record) return;
  const root = document.createElement('div');
  root.className = 'print-root';
  const template = document.getElementById('printTemplate').content.cloneNode(true);
  template.querySelector('.print-summary').innerHTML = `
    <div><strong>Họ và tên:</strong> ${escapeHtml(record.fullName)}</div>
    <div><strong>Số CCCD:</strong> ${escapeHtml(record.idNumber)}</div>
    <div><strong>Số CMND cũ:</strong> ${escapeHtml(record.oldIdNumber || '')}</div>
    <div><strong>Ngày sinh:</strong> ${escapeHtml(record.birthDate || '')}</div>
    <div><strong>Giới tính:</strong> ${escapeHtml(record.gender || '')}</div>
    <div><strong>Địa chỉ thường trú:</strong> ${escapeHtml(record.permanentAddress || '')}</div>
    <div><strong>Địa chỉ hiện tại:</strong> ${escapeHtml(record.currentAddress || '')}</div>
    <div><strong>Ngày cấp:</strong> ${escapeHtml(record.issueDate || '')}</div>
    <div><strong>Nơi cấp:</strong> ${escapeHtml(record.issuePlace || '')}</div>
  `;
  template.querySelector('.print-images').innerHTML = [record.frontImage, record.backImage, record.qrImage]
    .filter(Boolean)
    .map(src => `<img src="${src}" alt="Ảnh CCCD">`).join('');
  template.querySelector('.print-qr').innerHTML = `<strong>Dữ liệu QR:</strong><div>${escapeHtml(record.qrText || '')}</div>`;
  root.appendChild(template);
  document.body.appendChild(root);
  window.print();
  setTimeout(() => root.remove(), 300);
}

function resetFlow(showMessage = true) {
  state.captureStep = 'front';
  state.frontImage = '';
  state.backImage = '';
  state.qrImage = '';
  state.qrText = '';
  state.loadedRecordId = null;
  Object.values(formIds).forEach(id => document.getElementById(id).value = '');
  els.frontPreview.removeAttribute('src');
  els.backPreview.removeAttribute('src');
  els.qrPreview.removeAttribute('src');
  updateStepUI();
  if (showMessage) setBanner('Đã làm mới quy trình.', 'info');
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.records, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cccd-records-v2-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importJson(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('JSON không hợp lệ');
  for (const record of parsed) {
    await saveRecordToDb(record);
  }
  await loadRecordsFromDb();
  renderRecords();
  setBanner('Đã nhập dữ liệu từ JSON vào IndexedDB.', 'success');
}

async function handleUploadedFiles(files) {
  const file = files?.[0];
  if (!file) return;
  const dataUrl = await fileToDataUrl(file);

  if (state.captureStep === 'front') {
    state.frontImage = dataUrl;
    els.frontPreview.src = dataUrl;
    const processed = await preprocessImage(dataUrl, 'text');
    runOcr('front', processed);
    nextStep();
  } else if (state.captureStep === 'back') {
    state.backImage = dataUrl;
    els.backPreview.src = dataUrl;
    const processed = await preprocessImage(dataUrl, 'text');
    runOcr('back', processed);
    nextStep();
  } else {
    state.qrImage = dataUrl;
    els.qrPreview.src = dataUrl;
    const processed = await preprocessImage(dataUrl, 'qr');
    readQrFromDataUrl(processed);
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.getElementById('startCameraBtn').addEventListener('click', startCamera);
document.getElementById('switchCameraBtn').addEventListener('click', () => {
  state.useEnvironmentCamera = !state.useEnvironmentCamera;
  startCamera();
});
document.getElementById('captureBtn').addEventListener('click', () => captureFrame(false));
document.getElementById('scanQrBtn').addEventListener('click', () => {
  state.captureStep = 'qr';
  updateStepUI();
  setBanner('Đã chuyển sang bước QR. QR chỉ để bổ sung số CMND cũ nếu có.', 'info');
});
document.querySelectorAll('.step-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    state.captureStep = btn.dataset.step;
    updateStepUI();
  });
});
document.getElementById('saveRecordBtn').addEventListener('click', saveRecord);
document.getElementById('resetFlowBtn').addEventListener('click', () => resetFlow());
document.getElementById('copyAllBtn').addEventListener('click', copyAllCurrent);
document.getElementById('searchInput').addEventListener('input', renderRecords);
document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
document.getElementById('imageUpload').addEventListener('change', e => handleUploadedFiles(e.target.files));
document.getElementById('importJsonInput').addEventListener('change', async e => {
  try {
    if (e.target.files?.[0]) await importJson(e.target.files[0]);
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

(async function init() {
  try {
    state.db = await openDatabase();
    await loadRecordsFromDb();
    renderRecords();
    updateStepUI();
    setBanner('Bản v2 đã sẵn sàng: lưu IndexedDB, OCR mặt trước/sau, QR bổ sung CMND cũ.', 'info');
  } catch (error) {
    console.error(error);
    setBanner('Không mở được IndexedDB. Trình duyệt có thể đang chặn lưu trữ.', 'error');
  }
})();
