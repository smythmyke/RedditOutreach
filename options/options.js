const toneSelect = document.getElementById('tone');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

chrome.storage.local.get(['ro_tone'], (result) => {
  if (result.ro_tone) toneSelect.value = result.ro_tone;
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({ ro_tone: toneSelect.value }, () => {
    statusEl.classList.add('show');
    setTimeout(() => statusEl.classList.remove('show'), 2000);
  });
});
