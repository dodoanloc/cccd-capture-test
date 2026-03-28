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
};

const STORAGE_KEY = 'cccd_capture_records_v1';
const stepOrder = ['front', 'back', 'qr'];
const stepHints = {
  front: 'Bước 1: Chụp mặt trước CCCD',
  back: 'Bước 2: Chụp mặt sau CCCD',
  qr: 'Bước 3: Quét/chụp mã QR CCCD',
};

const els = {
  video: document.getElementById('video'),
  captureCanvas: document.getElementById('captureCanvas'),
  captureHint: document.getElementById('captureHint'),
  frontPreview: document.getElementById('frontPreview'),
  backPreview: document.getElementById('backPreview'),
  qrPreview: document.getElementById('qrPreview'),
  qrText: document.getElementById('qrText'),
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

function updateStepper() {
  document.querySelectorAll('.step').forEach((stepEl) => {
    stepEl.classList.toggle('active', stepEl.dataset.step === state.captureStep);
  });
  els.captureHint.textContent = stepHints[state.captureStep];
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
    setBanner('Camera đã sẵn sàng. Hãy chụp lần lượt mặt trước, mặt sau rồi quét QR.', 'success');
  } catch (error) {
    console.error(error);
    setBanner('Không bật được camera. Anh/chị có thể tải ảnh lên để tiếp tục.', 'error');
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
  }
}

function nextStep() {
  const idx = stepOrder.indexOf(state.captureStep);
  state.captureStep = stepOrder[Math.min(idx + 1, stepOrder.length - 1)];
  updateStepper();
}

function captureFrame() {
  if (!els.video.videoWidth || !els.video.videoHeight) {
    setBanner('Camera chưa có hình. Hãy bật camera hoặc đợi thiết bị tải xong.', 'error');
    return;
  }

  const canvas = els.captureCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = els.video.videoWidth;
  canvas.height = els.video.videoHeight;
  ctx.drawImage(els.video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

  if (state.captureStep === 'front') {
    state.frontImage = dataUrl;
    els.frontPreview.src = dataUrl;
    setBanner('Đã chụp mặt trước. Tiếp tục chụp mặt sau.', 'success');
    nextStep();
    return;
  }

  if (state.captureStep === 'back') {
    state.backImage = dataUrl;
    els.backPreview.src = dataUrl;
    setBanner('Đã chụp mặt sau. Bây giờ quét hoặc chụp mã QR.', 'success');
    nextStep();
    return;
  }

  if (state.captureStep === 'qr') {
    state.qrImage = dataUrl;
    els.qrPreview.src = dataUrl;
    readQrFromCanvas(canvas);
  }
}

function readQrFromCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = window.jsQR(imageData.data, canvas.width, canvas.height);

  if (!result) {
    setBanner('Chưa đọc được mã QR. Anh/chị thử căn lại QR rõ hơn hoặc tải ảnh QR lên.', 'error');
    return;
  }

  state.qrText = result.data;
  els.qrText.textContent = result.data;
  parseVietnamIdQr(result.data);
  setBanner('Đã đọc mã QR và tự điền dữ liệu vào biểu mẫu.', 'success');
}

function parseVietnamIdQr(raw) {
  const cleaned = raw.trim();
  const pipeParts = cleaned.split('|');
  if (pipeParts.length >= 6) {
    assignParsedFields({
      idNumber: pipeParts[0] || '',
      oldIdNumber: pipeParts[1] || '',
      fullName: toTitleCase(pipeParts[2] || ''),
      birthDate: formatCompactDate(pipeParts[3] || ''),
      gender: normalizeGender(pipeParts[4] || ''),
      permanentAddress: pipeParts[5] || '',
      issueDate: formatCompactDate(pipeParts[6] || ''),
    });
    return;
  }

  const lines = cleaned.split(/\n+/).map(x => x.trim()).filter(Boolean);
  if (lines.length >= 4) {
    assignParsedFields({
      idNumber: lines[0] || '',
      fullName: toTitleCase(lines[1] || ''),
      birthDate: formatCompactDate(lines[2] || ''),
      permanentAddress: lines.slice(3).join(', '),
    });
    return;
  }

  setBanner('Đã đọc QR nhưng chưa nhận diện đầy đủ cấu trúc dữ liệu. Có thể chỉnh tay ở form.', 'info');
}

function assignParsedFields(data) {
  Object.entries(data).forEach(([key, value]) => {
    if (formIds[key] && value) {
      document.getElementById(formIds[key]).value = value;
    }
  });

  if (!document.getElementById('currentAddress').value && data.permanentAddress) {
    document.getElementById('currentAddress').value = data.permanentAddress;
  }

  if (!document.getElementById('issuePlace').value) {
    document.getElementById('issuePlace').value = 'Cục Cảnh sát QLHC về TTXH';
  }
}

function normalizeGender(value) {
  const v = value.toLowerCase();
  if (v.includes('nam')) return 'Nam';
  if (v.includes('nu') || v.includes('nữ')) return 'Nữ';
  return value;
}

function formatCompactDate(value) {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4,8)}`;
  }
  return value;
}

function toTitleCase(value) {
  return value.toLowerCase().replace(/\b\p{L}/gu, char => char.toUpperCase());
}

function getFormData() {
  return Object.fromEntries(Object.entries(formIds).map(([key, id]) => [key, document.getElementById(id).value.trim()]));
}

function validateRecord(data) {
  if (!data.fullName) return 'Chưa có họ tên';
  if (!data.idNumber) return 'Chưa có số CCCD';
  if (!state.frontImage) return 'Chưa chụp mặt trước';
  if (!state.backImage) return 'Chưa chụp mặt sau';
  return '';
}

function saveRecord() {
  const formData = getFormData();
  const validationError = validateRecord(formData);
  if (validationError) {
    setBanner(validationError, 'error');
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

  persistRecords();
  renderRecords();
  setBanner('Đã lưu hồ sơ CCCD vào database cục bộ.', 'success');
  resetFlow(false);
}

function persistRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
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
  const records = state.records.filter(record => {
    if (!query) return true;
    return [
      record.fullName,
      record.idNumber,
      record.birthDate,
      record.gender,
      record.permanentAddress,
      record.currentAddress,
      record.issuePlace,
    ].join(' ').toLowerCase().includes(query);
  });

  if (!records.length) {
    els.recordsTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">Chưa có hồ sơ nào.</td></tr>';
    return;
  }

  els.recordsTableBody.innerHTML = records.map(record => `
    <tr>
      <td><strong>${escapeHtml(record.fullName)}</strong><small>${escapeHtml(record.currentAddress || record.permanentAddress || '')}</small></td>
      <td>${escapeHtml(record.idNumber)}<small>${record.oldIdNumber ? `CMND cũ: ${escapeHtml(record.oldIdNumber)}` : ''}</small></td>
      <td>${escapeHtml(record.birthDate || '')}</td>
      <td>${escapeHtml(record.gender || '')}</td>
      <td>${escapeHtml(record.permanentAddress || '')}</td>
      <td>${escapeHtml(record.issueDate || '')}<small>${escapeHtml(record.issuePlace || '')}</small></td>
      <td>
        <div class="row-actions">
          <button class="action-link" onclick="loadRecord('${record.id}')">Mở</button>
          <button class="action-link" onclick="copyRecord('${record.id}')">Copy</button>
          <button class="action-link" onclick="printRecord('${record.id}')">In</button>
          <button class="action-link" onclick="deleteRecord('${record.id}')">Xóa</button>
        </div>
      </td>
    </tr>
  `).join('');
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
  els.qrText.textContent = state.qrText || 'Chưa có dữ liệu QR.';
  setBanner(`Đã tải hồ sơ ${record.fullName} để xem/chỉnh sửa.`, 'info');
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
    `QR: ${record.qrText || ''}`,
  ].join('\n');
  await navigator.clipboard.writeText(text);
  setBanner(`Đã copy thông tin của ${record.fullName}.`, 'success');
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
    `QR: ${state.qrText}`,
  ].join('\n');
  await navigator.clipboard.writeText(text);
  setBanner('Đã copy toàn bộ thông tin đang hiển thị.', 'success');
}

function deleteRecord(id) {
  const record = state.records.find(r => r.id === id);
  if (!record) return;
  if (!confirm(`Xóa hồ sơ ${record.fullName}?`)) return;
  state.records = state.records.filter(r => r.id !== id);
  persistRecords();
  renderRecords();
  setBanner('Đã xóa hồ sơ khỏi database cục bộ.', 'success');
}

function printRecord(id) {
  const record = state.records.find(r => r.id === id);
  if (!record) return;

  const root = document.createElement('div');
  root.className = 'print-root';
  const template = document.getElementById('printTemplate');
  const content = template.content.cloneNode(true);
  content.querySelector('.print-summary').innerHTML = `
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

  content.querySelector('.print-images').innerHTML = [record.frontImage, record.backImage, record.qrImage]
    .filter(Boolean)
    .map(src => `<img src="${src}" alt="Ảnh CCCD">`).join('');

  content.querySelector('.print-qr').innerHTML = `<strong>Dữ liệu QR:</strong><div>${escapeHtml(record.qrText || '')}</div>`;
  root.appendChild(content);
  document.body.appendChild(root);
  window.print();
  setTimeout(() => root.remove(), 300);
}

function resetFlow(resetBanner = true) {
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
  els.qrText.textContent = 'Chưa có dữ liệu QR.';
  updateStepper();
  if (resetBanner) setBanner('Đã làm mới quy trình. Sẵn sàng chụp hồ sơ mới.', 'info');
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
      const records = JSON.parse(reader.result);
      if (!Array.isArray(records)) throw new Error('JSON không hợp lệ');
      state.records = records;
      persistRecords();
      renderRecords();
      setBanner('Đã nhập database từ file JSON.', 'success');
    } catch (error) {
      setBanner(error.message, 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function handleUploadedFiles(files) {
  const fileList = Array.from(files);
  const current = state.captureStep;
  const targets = current === 'front' ? ['front'] : current === 'back' ? ['back'] : ['qr'];

  fileList.slice(0, targets.length).forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = els.captureCanvas;
        const ctx = canvas.getContext('2d');
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

        if (targets[index] === 'front') {
          state.frontImage = dataUrl;
          els.frontPreview.src = dataUrl;
          nextStep();
        } else if (targets[index] === 'back') {
          state.backImage = dataUrl;
          els.backPreview.src = dataUrl;
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
document.getElementById('scanQrBtn').addEventListener('click', () => {
  state.captureStep = 'qr';
  updateStepper();
  setBanner('Đã chuyển sang bước quét QR. Hãy đưa mã QR vào giữa khung rồi bấm Chụp ảnh.', 'info');
});
document.getElementById('saveRecordBtn').addEventListener('click', saveRecord);
document.getElementById('resetFlowBtn').addEventListener('click', () => resetFlow());
document.getElementById('copyAllBtn').addEventListener('click', copyAllCurrent);
document.getElementById('searchInput').addEventListener('input', renderRecords);
document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
document.getElementById('imageUpload').addEventListener('change', (e) => handleUploadedFiles(e.target.files));
document.getElementById('importJsonInput').addEventListener('change', (e) => {
  if (e.target.files?.[0]) importJson(e.target.files[0]);
});

window.loadRecord = loadRecord;
window.copyRecord = copyRecord;
window.printRecord = printRecord;
window.deleteRecord = deleteRecord;

loadRecords();
renderRecords();
updateStepper();
setBanner('Sẵn sàng chụp hồ sơ mới.', 'info');
