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
  ocrWorker: null,
  db: null,
  ocrBusy: false,
};

const DB_NAME = 'cccd_capture_db';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const stepLabels = { front: 'Mặt trước', back: 'Mặt sau', qr: 'QR' };

const els = {
  video: document.getElementById('video'),
  captureCanvas: document.getElementById('captureCanvas'),
  captureHint: document.getElementById('captureHint'),
  captureSubtext: document.getElementById('captureSubtext'),
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
  expiryDate: 'expiryDate',
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
  els.captureSubtext.textContent = state.captureStep === 'qr'
    ? 'QR chỉ để bổ sung số CMND cũ nếu có'
    : 'Auto capture đã tắt. Chủ động chụp để OCR chính xác hơn';
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

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadRecordsFromDb() {
  const records = await reqToPromise(getStore('readonly').getAll());
  state.records = (records || []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function saveRecordToDb(record) {
  await reqToPromise(getStore('readwrite').put(record));
}

async function deleteRecordFromDb(id) {
  await reqToPromise(getStore('readwrite').delete(id));
}

async function startCamera() {
  try {
    stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: state.useEnvironmentCamera ? { ideal: 'environment' } : 'user',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    els.video.srcObject = state.stream;
    await els.video.play();
    setBanner('Camera đã sẵn sàng. Căn thẻ ngay ngắn rồi bấm chụp thủ công.', 'success');
  } catch (error) {
    console.error(error);
    setBanner('Không bật được camera. Có thể chuyển sang tải ảnh lên.', 'error');
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
  }
}

function nextStep() {
  if (state.captureStep === 'front') state.captureStep = 'back';
  else if (state.captureStep === 'back') state.captureStep = 'qr';
  updateStepUI();
}

function getVideoSnapshot() {
  const canvas = els.captureCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = els.video.videoWidth;
  canvas.height = els.video.videoHeight;
  ctx.drawImage(els.video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.96);
}

async function preprocessVariant(dataUrl, variant = 'base') {
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

      let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
      if (variant === 'front-crop') {
        sx = Math.round(canvas.width * 0.04);
        sy = Math.round(canvas.height * 0.08);
        sw = Math.round(canvas.width * 0.92);
        sh = Math.round(canvas.height * 0.82);
      } else if (variant === 'back-crop') {
        sx = Math.round(canvas.width * 0.03);
        sy = Math.round(canvas.height * 0.06);
        sw = Math.round(canvas.width * 0.94);
        sh = Math.round(canvas.height * 0.86);
      } else if (variant === 'qr-crop') {
        sx = Math.round(canvas.width * 0.62);
        sy = Math.round(canvas.height * 0.5);
        sw = Math.round(canvas.width * 0.28);
        sh = Math.round(canvas.height * 0.34);
      }

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = sw;
      cropCanvas.height = sh;
      const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
      cropCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      const imageData = cropCtx.getImageData(0, 0, sw, sh);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
        let v = avg;
        if (variant.includes('bw') || variant === 'qr-crop') {
          v = avg > 145 ? 255 : 0;
        } else if (variant.includes('contrast')) {
          v = avg > 160 ? 255 : avg < 90 ? 0 : avg * 1.1;
        }
        d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v));
      }
      cropCtx.putImageData(imageData, 0, 0);
      resolve(cropCanvas.toDataURL('image/jpeg', 0.96));
    };
    img.src = dataUrl;
  });
}

async function captureFrame() {
  if (!els.video.videoWidth || !els.video.videoHeight) {
    setBanner('Camera chưa có hình.', 'error');
    return;
  }
  const dataUrl = getVideoSnapshot();

  if (state.captureStep === 'front') {
    state.frontImage = dataUrl;
    els.frontPreview.src = dataUrl;
    setBanner('Đã chụp mặt trước. Đang OCR...', 'success');
    await runOcrForCurrentStep();
    nextStep();
    return;
  }

  if (state.captureStep === 'back') {
    state.backImage = dataUrl;
    els.backPreview.src = dataUrl;
    setBanner('Đã chụp mặt sau. Đang OCR...', 'success');
    await runOcrForCurrentStep();
    nextStep();
    return;
  }

  state.qrImage = dataUrl;
  els.qrPreview.src = dataUrl;
  setBanner('Đã chụp ảnh QR. Đang đọc QR...', 'info');
  await readQrFromImage(state.qrImage);
}

async function getWorker() {
  if (!state.ocrWorker) state.ocrWorker = await Tesseract.createWorker('vie+eng');
  return state.ocrWorker;
}

async function runOcrForCurrentStep() {
  if (state.ocrBusy) return;
  state.ocrBusy = true;
  try {
    if (state.captureStep === 'front' && state.frontImage) {
      const parsed = await runFrontOcrPipeline(state.frontImage);
      applyParsedFront(parsed);
      setBanner('Đã OCR mặt trước. Kiểm tra lại dữ liệu rồi chụp mặt sau.', 'success');
    } else if (state.captureStep === 'back' && state.backImage) {
      const parsed = await runBackOcrPipeline(state.backImage);
      applyParsedBack(parsed);
      setBanner('Đã OCR mặt sau. Tiếp theo có thể quét QR để lấy CMND cũ.', 'success');
    } else if (state.captureStep === 'qr' && state.qrImage) {
      await readQrFromImage(state.qrImage);
    }
  } catch (error) {
    console.error(error);
    setBanner('OCR chưa chuẩn ở ảnh này. Hãy chụp lại rõ hơn hoặc chỉnh tay.', 'error');
  } finally {
    state.ocrBusy = false;
  }
}

async function recognizeText(imageDataUrl) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageDataUrl);
  return normalizeOcrText(data.text || '');
}

async function runFrontOcrPipeline(imageDataUrl) {
  const variants = ['front-crop', 'front-crop-contrast', 'base'];
  const texts = [];
  for (const variant of variants) {
    const processed = await preprocessVariant(imageDataUrl, variant);
    const text = await recognizeText(processed);
    texts.push(text);
  }
  return parseFrontTexts(texts);
}

async function runBackOcrPipeline(imageDataUrl) {
  const variants = ['back-crop', 'back-crop-contrast', 'base'];
  const texts = [];
  for (const variant of variants) {
    const processed = await preprocessVariant(imageDataUrl, variant);
    const text = await recognizeText(processed);
    texts.push(text);
  }
  return parseBackTexts(texts);
}

function normalizeOcrText(text) {
  return text
    .replace(/[|]/g, 'I')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parseFrontTexts(texts) {
  const merged = texts.join('\n');
  const allLines = merged.split('\n').map(x => x.trim()).filter(Boolean);
  const idCandidates = [...merged.matchAll(/\b\d{12}\b/g)].map(m => m[0]);
  const birthCandidates = [...merged.matchAll(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/g)].map(m => normalizeDateString(m[0]));
  const genderCandidate = (/\bNam\b/i.test(merged) ? 'Nam' : /\bNữ\b|\bNu\b/i.test(merged) ? 'Nữ' : '');
  const issuePlace = (merged.match(/Cục[^\n]+TTXH|Cục Cảnh sát[^\n]+/i) || [])[0] || '';

  const upperLines = allLines.filter(line => /^[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ\s]{6,}$/.test(line));
  const probableName = upperLines.find(line => !/VIỆT NAM|CĂN CƯỚC|IDENTITY|CARD/i.test(line));

  const fallbackIssuePlace = merged.match(/Bộ Công an|Cục Cảnh sát[^\n]+|Cục[^\n]+TTXH/i)?.[0] || '';

  return {
    fullName: probableName ? toTitleCase(probableName) : '',
    idNumber: chooseBestIdNumber(idCandidates, lines),
    birthDate: mostFrequent(birthCandidates),
    gender: genderCandidate,
    issuePlace: cleanupIssuePlace(issuePlace || fallbackIssuePlace),
  };
}

function parseBackTexts(texts) {
  const merged = texts.join('\n');
  const lines = merged.split('\n').map(x => x.trim()).filter(Boolean);
  const allDates = [...merged.matchAll(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/g)].map(m => normalizeDateString(m[0]));
  const issueDate = allDates[0] || '';
  const expiryDate = allDates[1] || (/không thời hạn/i.test(merged) ? 'Không thời hạn' : '');
  const permanentAddress = extractAddress(lines, [/thường trú/i, /noi thuong tru/i]);
  const currentAddress = extractAddress(lines, [/nơi ở hiện tại/i, /hiện tại/i, /noi o hien tai/i]) || permanentAddress;
  const issuePlace = extractIssuePlaceFromBack(lines, merged);

  return {
    issueDate,
    expiryDate,
    issuePlace,
    permanentAddress,
    currentAddress,
  };
}

function mostFrequent(arr) {
  if (!arr || !arr.length) return '';
  const map = new Map();
  arr.forEach(v => map.set(v, (map.get(v) || 0) + 1));
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0][0] || '';
}

function chooseBestIdNumber(candidates, lines) {
  const clean = candidates.filter(Boolean);
  if (clean.length) return mostFrequent(clean);
  for (const line of lines) {
    const digits = line.replace(/\D/g, ' ');
    const match = digits.match(/\b\d{12}\b/);
    if (match) return match[0];
  }
  return '';
}

function extractIssuePlaceFromBack(lines, merged) {
  const joined = lines.join(' ');
  const match = joined.match(/Bộ Công an|Cục Cảnh sát[^\n]+|Cục[^\n]+TTXH/i) || merged.match(/Bộ Công an|Cục Cảnh sát[^\n]+|Cục[^\n]+TTXH/i);
  return cleanupIssuePlace(match?.[0] || '');
}

function extractAddress(lines, patterns) {
  const idx = lines.findIndex(line => patterns.some(regex => regex.test(line)));
  if (idx >= 0) {
    const slice = lines.slice(idx + 1, idx + 5).join(' ').trim();
    if (slice) return cleanupAddress(slice);
  }
  const addressLike = lines.filter(line => /xã|phường|thị trấn|huyện|quận|tỉnh|thành phố/i.test(line));
  return addressLike.length ? cleanupAddress(addressLike.slice(0, 3).join(', ')) : '';
}

function cleanupAddress(value) {
  return value.replace(/^[,:;\-\s]+/, '').replace(/\s{2,}/g, ' ').trim();
}

function cleanupIssuePlace(value) {
  return String(value || '').replace(/\s{2,}/g, ' ').trim();
}

function applyParsedFront(parsed) {
  assignParsedFields(parsed, false);
}

function applyParsedBack(parsed) {
  assignParsedFields(parsed, false);
}

async function readQrFromImage(imageDataUrl) {
  const variants = ['qr-crop', 'base'];
  for (const variant of variants) {
    const processed = await preprocessVariant(imageDataUrl, variant);
    const result = await readQrData(processed);
    if (result) {
      state.qrText = result;
      parseVietnamIdQr(result);
      setBanner('Đã đọc QR. Nếu có CMND cũ thì hệ thống đã tự điền.', 'success');
      return;
    }
  }
  setBanner('Chưa đọc được QR. Không sao, dữ liệu chính vẫn lấy từ ảnh trước/sau.', 'error');
}

function readQrData(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = window.jsQR(imageData.data, canvas.width, canvas.height);
      resolve(result?.data || '');
    };
    img.src = dataUrl;
  });
}

function parseVietnamIdQr(raw) {
  const cleaned = raw.trim();
  const parts = cleaned.split('|');
  if (parts.length >= 2) {
    assignParsedFields({
      idNumber: parts[0] || '',
      oldIdNumber: parts[1] || '',
    }, true);
    return;
  }
  const cmnd = cleaned.match(/\b\d{9}\b/);
  if (cmnd) assignParsedFields({ oldIdNumber: cmnd[0] }, true);
}

function assignParsedFields(data, preferOverwrite = false) {
  Object.entries(data).forEach(([key, value]) => {
    if (!formIds[key] || !value) return;
    const input = document.getElementById(formIds[key]);
    if (preferOverwrite || !input.value.trim()) input.value = value.trim();
  });
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
  setBanner('Đã lưu hồ sơ vào IndexedDB.', 'success');
  resetFlow(false);
}

function renderRecords() {
  const query = els.searchInput.value.trim().toLowerCase();
  const filtered = state.records.filter(record => {
    if (!query) return true;
    return [record.fullName, record.idNumber, record.oldIdNumber, record.permanentAddress, record.currentAddress]
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
    `Ngày hết hạn: ${record.expiryDate || ''}`,
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
    `Ngày hết hạn: ${data.expiryDate}`,
    `Nơi cấp: ${data.issuePlace}`,
  ].join('\n');
  await navigator.clipboard.writeText(text);
  setBanner('Đã copy toàn bộ thông tin.', 'success');
}

function fillCurrentFromPermanent() {
  const perm = document.getElementById('permanentAddress').value.trim();
  if (!perm) {
    setBanner('Chưa có địa chỉ thường trú để copy.', 'error');
    return;
  }
  document.getElementById('currentAddress').value = perm;
  setBanner('Đã copy địa chỉ thường trú sang địa chỉ hiện tại.', 'success');
}

async function deleteRecord(id) {
  const record = state.records.find(r => r.id === id);
  if (!record) return;
  if (!confirm(`Xóa hồ sơ ${record.fullName}?`)) return;
  await deleteRecordFromDb(id);
  await loadRecordsFromDb();
  renderRecords();
  setBanner('Đã xóa hồ sơ.', 'success');
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
    <div><strong>Ngày hết hạn:</strong> ${escapeHtml(record.expiryDate || '')}</div>
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
  a.download = `cccd-records-v3-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importJson(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('JSON không hợp lệ');
  for (const record of parsed) await saveRecordToDb(record);
  await loadRecordsFromDb();
  renderRecords();
  setBanner('Đã nhập JSON vào IndexedDB.', 'success');
}

async function handleUploadedFiles(files) {
  const file = files?.[0];
  if (!file) return;
  const dataUrl = await fileToDataUrl(file);
  if (state.captureStep === 'front') {
    state.frontImage = dataUrl;
    els.frontPreview.src = dataUrl;
    await runOcrForCurrentStep();
    nextStep();
  } else if (state.captureStep === 'back') {
    state.backImage = dataUrl;
    els.backPreview.src = dataUrl;
    await runOcrForCurrentStep();
    nextStep();
  } else {
    state.qrImage = dataUrl;
    els.qrPreview.src = dataUrl;
    await readQrFromImage(dataUrl);
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
document.getElementById('captureBtn').addEventListener('click', captureFrame);
document.getElementById('runOcrBtn').addEventListener('click', runOcrForCurrentStep);
document.getElementById('scanQrBtn').addEventListener('click', async () => {
  state.captureStep = 'qr';
  updateStepUI();
  if (state.qrImage) await readQrFromImage(state.qrImage);
  else setBanner('Đã chuyển sang bước QR. Hãy chụp QR hoặc tải ảnh QR lên.', 'info');
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
document.getElementById('fillCurrentFromPermanentBtn').addEventListener('click', fillCurrentFromPermanent);
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
    setBanner('V3 đã sẵn sàng: auto capture tắt, OCR pipeline nhiều lớp, IndexedDB ổn định hơn.', 'info');
  } catch (error) {
    console.error(error);
    setBanner('Không mở được IndexedDB.', 'error');
  }
})();
