"""seo group_invite routes."""
from backend.api.seo._blueprint import seo_bp
from flask import request, render_template_string


@seo_bp.route("/join/<group_id>")
def group_invite_landing(group_id: str):
    """Smart deep-link landing page.

    Tries to open the native app via custom URL scheme first.  If the app is
    not installed (or fails to open), the page falls back to the web prayer-room
    flow after a short timeout.
    """
    from urllib.parse import urlencode, quote

    code = (request.args.get("code") or "").strip()

    # Build the custom-scheme deep link the native app understands
    app_url = f"io.divinebridge.app://join/{quote(group_id)}"
    if code:
        app_url += f"?code={quote(code)}"

    # Web fallback URL (existing behaviour)
    q = {"join_group": group_id}
    if code:
        q["invite_code"] = code
    web_fallback = "/prayers?" + urlencode(q)

    return render_template_string(
        _GROUP_INVITE_LANDING_HTML,
        app_url=app_url,
        web_fallback=web_fallback,
        group_id=group_id,
    )


_GROUP_INVITE_LANDING_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Join Group — Divine Bridge</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#faf6ef;color:#3d3425;display:flex;align-items:center;justify-content:center;
    min-height:100dvh;padding:24px;text-align:center;
  }
  .card{max-width:380px;width:100%}
  .icon{
    width:80px;height:80px;margin:0 auto 20px;border-radius:22px;
    background:#f0ebe2;border:1px solid #e5dfd4;display:flex;align-items:center;
    justify-content:center;font-size:36px;
  }
  h1{font-size:22px;font-weight:700;margin-bottom:6px;letter-spacing:-.3px}
  .sub{color:#8a7e6b;font-size:14px;margin-bottom:28px}
  .spinner{
    width:28px;height:28px;border:3px solid #e5dfd4;border-top-color:#c8a84e;
    border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 16px;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  .btn{
    display:inline-block;width:100%;padding:16px;border-radius:14px;font-size:16px;
    font-weight:700;text-decoration:none;cursor:pointer;border:none;
  }
  .btn-primary{background:#c8a84e;color:#fff;margin-bottom:12px}
  .btn-primary:active{opacity:.85}
  .btn-secondary{background:transparent;color:#8a7e6b;font-weight:500;font-size:14px}
  .hidden{display:none}
</style>
</head>
<body>
<div class="card">
  <!-- Phase 1: attempting to open app -->
  <div id="opening">
    <div class="icon">🙏</div>
    <h1>Opening Divine Bridge…</h1>
    <p class="sub">If the app doesn't open, use the buttons below.</p>
    <div class="spinner"></div>
  </div>

  <!-- Phase 2: fallback buttons (shown after timeout or immediately if scheme fails) -->
  <div id="fallback" class="hidden">
    <div class="icon">🙏</div>
    <h1>Join a Prayer Group</h1>
    <p class="sub">Open in the Divine Bridge app, or continue in your browser.</p>
    <a class="btn btn-primary" id="openApp" href="{{ app_url }}">Open in App</a>
    <a class="btn btn-secondary" href="{{ web_fallback }}">Continue in browser</a>
  </div>
</div>

<script>
(function(){
  var appUrl = {{ app_url | tojson }};
  var fallbackUrl = {{ web_fallback | tojson }};
  var opening = document.getElementById('opening');
  var fallback = document.getElementById('fallback');

  // Try opening the app immediately via a hidden iframe (works on iOS/Android
  // without navigating away from the page if the scheme isn't registered).
  var iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = appUrl;
  document.body.appendChild(iframe);

  // Also set window.location as backup (some browsers ignore iframe schemes)
  setTimeout(function(){ window.location.href = appUrl; }, 100);

  // After 2 s, if we're still on the page the app didn't open — show fallback
  setTimeout(function(){
    opening.classList.add('hidden');
    fallback.classList.remove('hidden');
  }, 2000);
})();
</script>
</body>
</html>
"""
