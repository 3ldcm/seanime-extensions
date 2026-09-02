(() => {
  const old = document.getElementById("seanime-remote-cast-test");
  if (old) old.remove();

  const btn = document.createElement("button");
  btn.id = "seanime-remote-cast-test";
  btn.textContent = "📺 CAST";
  btn.style.position = "fixed";
  btn.style.right = "16px";
  btn.style.bottom = "90px";
  btn.style.zIndex = "2147483647";
  btn.style.padding = "12px 18px";
  btn.style.fontSize = "18px";

  btn.addEventListener("click", async () => {
    const video = document.querySelector(
      'video[data-video-core-element], video[data-vc-element="video"], video'
    );

    if (!video) {
      alert("Aucune balise <video> trouvée.");
      return;
    }

    try {
      video.disableRemotePlayback = false;

      if (!video.remote) {
        alert("Remote Playback API indisponible sur ce navigateur.");
        return;
      }

      await video.remote.prompt();
    } catch (err) {
      alert("Remote Playback: " + (err?.message || err));
      console.error(err);
    }
  });

  document.body.appendChild(btn);
})();
