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
};

const STORAGE_KEY = 'cccd_capture_records_v2';
const stepLabels = {
  front: 'Mặt trước',
  back: 'Mặt sau',
  qr: 'QR',
};

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
    ? 'Ưu tiên đọc QR để tìm số CMND cũ (nếu có)'
    : 'Tự động chụp khi thẻ rõ và đứng yên';
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
    setBanner('Camera đã sẵn sàng. Đưa thẻ vào khung, hệ thống sẽ tự chụp khi ảnh đủ rõ.', 'success');
    startAutoCaptureLoop();
  } catch (error) {
    console.error(error);
    setBanner('Không bật được camera. Có thể tải ảnh lên để tiếp tục.', 'error');
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
  }, 900);
}

function checkFrameReadiness() {
  const canvas = els.captureCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = 480;
  canvas.height = 300;
  ctx.drawImage(els.video, 0, 0, canvas.width, canvas.height);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let total = 0;
  let sharpness = 0;
  for (let i = 0; i < data.length; i += 4 * 12) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    total += gray;
  }
  for (let y = 1; y < height - 1; y += 4) {
    for (let x = 1; x < width - 1; x += 4) {
      const idx = (y * width + x) * 4;
      const center = data[idx];
      const right = data[idx + 4];
      const bottom = data[idx + width * 4];
      sharpness += Math.abs(center - right) + Math.abs(center - bottom);
    }
  }

  const brightness = total / (data.length / (4 * 12));
  const frameSharpEnough = sharpness > 180000;
  const frameBrightEnough = brightness > 70 && brightness < 220;

  if (frameSharpEnough && frameBrightEnough) {
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

function captureFrame(auto = false) {
  if (!els.video.videoWidth || !els.video.videoHeight) {
    setBanner('Camera chưa có hình. Hãy bật camera hoặc đợi thiết bị tải xong.', 'error');
    return;
  }

  const canvas = els.captureCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = els.video.videoWidth;
  canvas.height = els.video.videoHeight;
  ctx.drawImage(els.video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

  if (state.captureStep === 'front') {
    state.frontImage = dataUrl;
    els.frontPreview.src = dataUrl;
    setBanner(auto ? 'Đã tự động chụp mặt trước. Đang nhận dạng chữ...' : 'Đã chụp mặt trước. Đang nhận dạng chữ...', 'success');
    runOcr('front', dataUrl);
    nextStep();
    return;
  }

  if (state.captureStep === 'back') {
    state.backImage = dataUrl;
    els.backPreview.src = dataUrl;
    setBanner(auto ? 'Đã tự động chụp mặt sau. Đang nhận dạng nội dung...' : 'Đã chụp mặt sau. Đang nhận dạng nội dung...', 'success');
    runOcr('back', dataUrl);
    nextStep();
    return;
  }

  state.qrImage = dataUrl;
  els.qrPreview.src = dataUrl;
  setBanner('Đã chụp vùng QR. Đang đọc QR để tìm số CMND cũ (nếu có)...', 'info');
  readQrFromCanvas(canvas);
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
    if (side === 'back') parseBackText(text);
  } catch (error) {
    console.error(error);
    setBanner('OCR chưa đọc tốt ảnh vừa chụp. Có thể chỉnh tay các trường bên dưới.', 'error');
  }
}

function normalizeOcrText(text) {
  return text
    .replace(/[|]/g, 'I')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parseFrontText(text) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const idMatch = text.match(/\b\d{12}\b/);
  const birthMatch = text.match(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/);
  const genderMatch = text.match(/\bNam\b|\bNữ\b/i);

  const upperLines = lines.filter(line => /^[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ\s]{6,}$/.test(line));
  const probableName = upperLines.find(line => !line.includes('VIỆT NAM') && !line.includes('CĂN CƯỚC'));

  const issuePlaceHint = text.includes('Cục Cảnh sát quản lý hành chính về trật tự xã hội')
    ? 'Cục Cảnh sát quản lý hành chính về trật tự xã hội'
    : '';

  assignParsedFields({
    idNumber: idMatch?.[0] || '',
    birthDate: birthMatch ? normalizeDateString(birthMatch[0]) : '',
    gender: genderMatch ? normalizeGender(genderMatch[0]) : '',
    fullName: probableName ? toTitleCase(probableName) : '',
    issuePlace: issuePlaceHint,
  }, false);

  setBanner('Đã nhận dạng mặt trước. Kiểm tra lại dữ liệu và tiếp tục quét QR.', 'success');
}

function parseBackText(text) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const joined = lines.join(' ');
  const issueDateMatch = joined.match(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/);

  let permanentAddress = '';
  let currentAddress = '';

  const thuongTruIdx = lines.findIndex(line => /thường trú/i.test(line));
  if (thuongTruIdx >= 0) {
    permanentAddress = lines.slice(thuongTruIdx + 1, thuongTruIdx + 4).join(' ').trim();
  }

  const currentIdx = lines.findIndex(line => /nơi ở hiện tại|hiện tại/i.test(line));
  if (currentIdx >= 0) {
    currentAddress = lines.slice(currentIdx + 1, currentIdx + 4).join(' ').trim();
  }

  if (!permanentAddress) {
    const addressLike = lines.filter(line => /xã|phường|thị trấn|huyện|quận|tỉnh|thành phố/i.test(line));
    if (addressLike.length) permanentAddress = addressLike.slice(0, 2).join(', ');
  }
  if (!currentAddress) currentAddress = permanentAddress;

  assignParsedFields({
    issueDate: issueDateMatch ? normalizeDateString(issueDateMatch[0]) : '',
    permanentAddress,
    currentAddress,
  }, false);

  setBanner('Đã nhận dạng mặt sau. QR giờ chỉ dùng để lấy số CMND cũ nếu có.', 'success');
}

function readQrFromCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = window.jsQR(imageData.data, canvas.width, canvas.height);

  if (!result) {
    setBanner('Chưa đọc được QR. Thử chụp lại gần hơn. Các trường chính vẫn lấy từ ảnh mặt trước/mặt sau.', 'error');
    return;
  }

  state.qrText = result.data;
  parseVietnamIdQr(result.data);
  setBanner('Đã đọc QR. Nếu QR có chứa CMND cũ thì hệ thống đã tự điền.', 'success');
}

function parseVietnamIdQr(raw) {
  const cleaned = raw.trim();
  const pipeParts = cleaned.split('|');

  if (pipeParts.length >= 2) {
    const idNumberFromQr = pipeParts[0] || '';
    const oldId = pipeParts[1] || '';
    assignParsedFields({
      idNumber: idNumberFromQr,
      oldIdNumber: oldId,
    }, true);
    return;
  }

  const cmndMatch = cleaned.match(/\b\d{9}\b/);
  if (cmndMatch) {
    assignParsedFields({ oldIdNumber: cmndMatch[0] }, true);
  }
}

function assignParsedFields(data, preferOverwrite = false) {
  Object.entries(data).forEach(([key, value]) => {
    if (!formIds[key] || !value) return;
    const el = document.getElementById(formIds[key]);
    if (preferOverwrite || !el.value.trim()) {
      el.value = value.trim();
    }
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

function saveRecord() {
  const formData = getFormData();
  const error = validateRecord(formData);
  if (error) {
    setBanner(error, 'error');
    return;
  }

  const record = {
    id: state.loadedRecordId || crypto.randomUUID(),
    ...formData,
    qrText: state.qrText,
    frontImage: state.frontImage,
    backImage: state.backImage,
    qrImage: state.qrImage,
    updatedAt: new Date().toISOString(),
    createdAt: state.loadedRecordId
      ? (state.records.find(r => r.id === state.loadedRecordId)?.createdAt || new Date().toISOString())
      : new Date().toISOString(),
  };

  const idx = state.records.findIndex(r => r.id === record.id);
  if (idx >= 0) state.records[idx] = record;
  else state.records.unshift(record);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
  renderRecords();
  setBanner('Đã lưu hồ sơ vào database cục bộ.', 'success');
  resetFlow(false);
}

function loadRecords() {
  try {
    state.records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    state.records = [];
  }
}

function renderRecords() {
  const query = els.searchInput.value.trim().toLowerCase();
  const filtered = state.records.filter(record => {
    if (!query) return true;
    return [record.fullName, record.idNumber, record.permanentAddress, record.currentAddress].join(' ').toLowerCase().includes(query);
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
  setBanner('Đã copy toàn bộ thông tin đang hiển thị.', 'success');
}

function deleteRecord(id) {
  const record = state.records.find(r => r.id === id);
  if (!record) return;
  if (!confirm(`Xóa hồ sơ ${record.fullName}?`)) return;
  state.records = state.records.filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
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
  a.download = `cccd-records-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed)) throw new Error('JSON không hợp lệ');
      state.records = parsed;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
      renderRecords();
      setBanner('Đã nhập database từ JSON.', 'success');
    } catch (error) {
      setBanner(error.message, 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function handleUploadedFiles(files) {
  const file = files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const canvas = els.captureCanvas;
      const ctx = canvas.getContext('2d');
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.drawImage(image, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

      if (state.captureStep === 'front') {
        state.frontImage = dataUrl;
        els.frontPreview.src = dataUrl;
        runOcr('front', dataUrl);
        nextStep();
      } else if (state.captureStep === 'back') {
        state.backImage = dataUrl;
        els.backPreview.src = dataUrl;
        runOcr('back', dataUrl);
        nextStep();
      } else {
        state.qrImage = dataUrl;
        els.qrPreview.src = dataUrl;
        readQrFromCanvas(canvas);
      }
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
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
  setBanner('Đã chuyển sang bước QR. QR chỉ dùng để lấy số CMND cũ (nếu có).', 'info');
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
document.getElementById('importJsonInput').addEventListener('change', e => {
  if (e.target.files?.[0]) importJson(e.target.files[0]);
});

loadRecords();
renderRecords();
updateStepUI();
setBanner('Sẵn sàng chụp hồ sơ mới.', 'info');
