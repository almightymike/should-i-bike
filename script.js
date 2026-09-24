const checks = [...document.querySelectorAll('input[name="ride-check"]')];
const progress = document.querySelector('#progress');

function updateProgress() {
  const reviewed = checks.filter((check) => check.checked).length;
  progress.textContent = `${reviewed} of ${checks.length} checks reviewed.`;
}

checks.forEach((check) => check.addEventListener('change', updateProgress));
