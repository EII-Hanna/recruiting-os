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
});
