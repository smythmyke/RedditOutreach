const toneSelect = document.getElementById('tone');
const projectSelect = document.getElementById('project');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

// Load saved values
chrome.storage.local.get(['ro_default_tone', 'ro_project'], (result) => {
  if (result.ro_default_tone) toneSelect.value = result.ro_default_tone;
  if (result.ro_project) projectSelect.value = result.ro_project;
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    ro_default_tone: toneSelect.value,
    ro_project: projectSelect.value
  }, () => {
    statusEl.classList.add('show');
    setTimeout(() => statusEl.classList.remove('show'), 2000);
  });
});
