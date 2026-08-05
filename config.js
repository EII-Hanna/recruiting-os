window.RECRUITING_OS_CONFIG = {
  supabaseUrl: "https://kmmqoqirdzdycxyoamqr.supabase.co",
  supabasePublishableKey: "sb_publishable_Ylu9MZaU-DmqJvRmjBz-uA_6Sl6QyXi"
};

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.sidebar .nav');
  if (nav && !document.getElementById('integrationsLink')) {
    const link = document.createElement('a');
    link.id = 'integrationsLink';
    link.href = './integrations.html';
    link.className = 'btn full';
    link.textContent = 'Integrationen';
    link.style.marginTop = '12px';
    nav.appendChild(link);
  }

  if (!document.querySelector('link[data-candidate-submissions]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = './candidate-submissions.css?v=20260805-1455';
    style.dataset.candidateSubmissions = '1';
    document.head.appendChild(style);
  }

  if (!document.querySelector('script[data-candidate-submissions]')) {
    const script = document.createElement('script');
    script.src = './candidate-submissions.js?v=20260805-1455';
    script.defer = true;
    script.dataset.candidateSubmissions = '1';
    document.body.appendChild(script);
  }
});
