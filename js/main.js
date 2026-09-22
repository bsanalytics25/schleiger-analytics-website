// Mobile navigation toggle and contact-page email copying.
document.addEventListener("DOMContentLoaded", () => {
  const menu = document.querySelector(".menu");
  const nav = document.querySelector(".nav nav");

  if (menu && nav) {
    menu.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      menu.setAttribute("aria-expanded", String(open));
      menu.textContent = open ? "Close" : "Menu";
    });
  }

  const copyButton = document.querySelector("#copy-email");
  const copyStatus = document.querySelector("#email-copy-status");

  if (copyButton && copyStatus) {
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(copyButton.dataset.email);
        copyButton.textContent = "Email copied";
        copyStatus.textContent = "Email address copied to your clipboard.";
      } catch {
        copyStatus.textContent = `Copy this address: ${copyButton.dataset.email}`;
      }
    });
  }
});
