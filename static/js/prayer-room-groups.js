/**
 * Prayer Room — Prayer Groups (web)
 * Uses /api/groups/* (Bearer token) + Firestore group_chat_messages/{groupId}/messages
 */
(function () {
  'use strict';

  var COLLECTION = 'group_chat_messages';

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function displayName() {
    var u = typeof currentUser !== 'undefined' && currentUser ? currentUser : null;
    if (!u) return 'Member';
    return (u.displayName && u.displayName.trim()) || (u.email && u.email.split('@')[0]) || 'Member';
  }

  function normalizeHttpsUrl(raw) {
    var t = (raw || '').trim();
    if (!t) return null;
    if (/^https:\/\//i.test(t)) return t;
    if (/^http:\/\//i.test(t)) return t.replace(/^http:/i, 'https:');
    if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(t)) return 'https://' + t;
    return null;
  }

  function storageSafeName(orig) {
    var parts = String(orig || 'file').split('.');
    var ext = (parts.pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    return Date.now() + '_' + Math.random().toString(36).slice(2, 10) + '.' + ext;
  }

  async function uploadGroupChatFileWeb(groupId, file) {
    if (!currentUser) throw new Error('Not signed in');
    if (file.size > 10 * 1024 * 1024) throw new Error('File must be 10 MB or smaller');
    var ct = file.type || 'application/octet-stream';
    if (!/^image\//.test(ct) && ct !== 'application/pdf') {
      throw new Error('Only photos and PDF files are allowed');
    }
    if (typeof firebase === 'undefined' || !firebase.storage) {
      throw new Error('Storage is not available. Refresh the page and try again.');
    }
    var uid = currentUser.uid;
    var path = 'group_chat_uploads/' + groupId + '/' + uid + '/' + storageSafeName(file.name);
    var ref = firebase.storage().ref(path);
    await ref.put(file, { contentType: ct });
    var url = await ref.getDownloadURL();
    return {
      url: url,
      content_type: ct,
      file_name: String(file.name || 'file').slice(0, 200),
      size_bytes: file.size,
    };
  }

  async function authHeaders() {
    var u = typeof currentUser !== 'undefined' && currentUser ? currentUser : firebase.auth().currentUser;
    if (!u) throw new Error('SIGN_IN_REQUIRED');
    var token = await u.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    };
  }

  async function apiGet(path) {
    var h = await authHeaders();
    var res = await fetch(path, { headers: h });
    var text = await res.text();
    var json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (e) {}
    if (!res.ok) throw new Error(json.error || json.message || 'Request failed (' + res.status + ')');
    return json;
  }

  async function apiPost(path, body) {
    var h = await authHeaders();
    var res = await fetch(path, {
      method: 'POST',
      headers: h,
      body: body != null ? JSON.stringify(body) : '{}',
    });
    var text = await res.text();
    var json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (e) {}
    if (!res.ok) throw new Error(json.error || json.message || 'Request failed (' + res.status + ')');
    return json;
  }

  function tsMs(val) {
    if (typeof val === 'number' && !isNaN(val)) return val;
    if (val && typeof val.toMillis === 'function') return val.toMillis();
    return 0;
  }

  var unsubChat = null;
  var selectedGroup = null;
  var listRefreshTimer = null;

  function leaveChatListener() {
    if (unsubChat) {
      unsubChat();
      unsubChat = null;
    }
  }

  function getDb() {
    if (typeof firebase === 'undefined') return null;
    try {
      return firebase.firestore();
    } catch (e) {
      return null;
    }
  }

  /** From /prayers?join_group=…&invite_code=… (after /join/… redirect or shared link). */
  function joinIntentGroupId() {
    try {
      var id = new URLSearchParams(location.search).get('join_group');
      return id && String(id).trim() ? String(id).trim() : null;
    } catch (e) {
      return null;
    }
  }

  function joinIntentInviteCode() {
    try {
      var p = new URLSearchParams(location.search);
      return (p.get('invite_code') || p.get('code') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function clearJoinIntentFromUrl() {
    try {
      var params = new URLSearchParams(location.search);
      params.delete('join_group');
      params.delete('invite_code');
      params.delete('code');
      var qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + '#groups');
    } catch (e) {}
  }

  var joinIntentInProgress = false;

  /** Community feed visible + tab chrome; does not change the URL (used when #groups is present but user is not signed in yet). */
  function showCommunityPanelOnly() {
    var feed = $('prayers-feed-view');
    var groups = $('pr-groups-panel');
    var fab = $('prayer-fab');
    var tabFeed = $('pr-tab-feed');
    var tabGroups = $('pr-tab-groups');
    if (feed) feed.style.display = '';
    if (groups) groups.style.display = 'none';
    if (fab) fab.style.display = 'flex';
    if (tabFeed) tabFeed.classList.add('active');
    if (tabGroups) tabGroups.classList.remove('active');
    leaveChatListener();
    selectedGroup = null;
  }

  function setTab(mode) {
    var feed = $('prayers-feed-view');
    var groups = $('pr-groups-panel');
    var fab = $('prayer-fab');
    var tabFeed = $('pr-tab-feed');
    var tabGroups = $('pr-tab-groups');
    if (mode === 'feed') {
      if (feed) feed.style.display = '';
      if (groups) groups.style.display = 'none';
      if (fab) fab.style.display = 'flex';
      if (tabFeed) tabFeed.classList.add('active');
      if (tabGroups) tabGroups.classList.remove('active');
      leaveChatListener();
      selectedGroup = null;
      if (location.hash === '#groups') {
        history.replaceState(null, '', location.pathname + location.search);
      }
    } else {
      if (feed) feed.style.display = 'none';
      if (groups) groups.style.display = 'block';
      if (fab) fab.style.display = 'none';
      if (tabFeed) tabFeed.classList.remove('active');
      if (tabGroups) tabGroups.classList.add('active');
      if (location.hash !== '#groups') {
        history.replaceState(null, '', location.pathname + location.search + '#groups');
      }
      scheduleListRefresh();
    }
  }

  /**
   * Keep Community vs Groups aligned with location.hash, join invite query params, and auth.
   * - ?join_group= (invite link) → Groups tab so sign-in / auto-join can run in context.
   * - /prayers#groups + signed in → Groups tab.
   * - /prayers#groups + guest (no join intent) → Community feed visible but #groups kept for post-login.
   */
  function syncTabToLocation() {
    if (joinIntentGroupId()) {
      setTab('groups');
      return;
    }
    if (location.hash === '#groups') {
      if (typeof currentUser !== 'undefined' && currentUser) {
        setTab('groups');
      } else {
        showCommunityPanelOnly();
      }
      return;
    }
    setTab('feed');
  }

  async function tryConsumeJoinIntent() {
    var gid = joinIntentGroupId();
    if (!gid) return;
    if (!(typeof currentUser !== 'undefined' && currentUser)) return;
    if (joinIntentInProgress) return;

    joinIntentInProgress = true;
    var code = joinIntentInviteCode();
    try {
      var body = code ? { code: code.toUpperCase() } : {};
      await apiPost('/api/groups/' + encodeURIComponent(gid) + '/join', body);
      clearJoinIntentFromUrl();
      setTab('groups');
      await renderListView();
      await openGroupDetail(gid, 'Group');
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error(e);
      alert(e.message || 'Could not join this group.');
    } finally {
      joinIntentInProgress = false;
    }
  }

  function scheduleListRefresh() {
    if (listRefreshTimer) clearTimeout(listRefreshTimer);
    listRefreshTimer = setTimeout(function () {
      listRefreshTimer = null;
      if ($('pr-groups-panel') && $('pr-groups-panel').style.display !== 'none') {
        renderListView().catch(function (e) {
          console.error(e);
        });
      }
    }, 0);
  }

  function postLoginPrayersRedirect() {
    if (joinIntentGroupId()) {
      return location.pathname + location.search;
    }
    return '/prayers#groups';
  }

  function openLogin() {
    var redir = postLoginPrayersRedirect();
    if (typeof openLoginGate === 'function') {
      openLoginGate({
        title: 'Sign in for prayer groups',
        message: joinIntentGroupId()
          ? 'Sign in to accept this group invite.'
          : 'Create an account or sign in to join groups, chat, and start live group prayer.',
        redirect: redir,
      });
    } else {
      window.location.href = '/login?redirect=' + encodeURIComponent(redir);
    }
  }

  async function renderListView() {
    var root = $('pr-groups-list-root');
    if (!root) return;
    var uid = typeof currentUser !== 'undefined' && currentUser ? currentUser.uid : null;
    if (!uid) {
      var inviteCopy = joinIntentGroupId()
        ? "You've been invited to a prayer group. Sign in to join."
        : 'Sign in to see your groups and join with an invite code.';
      root.innerHTML =
        '<div class="pr-groups-card"><p class="pr-groups-muted">' +
        esc(inviteCopy) +
        '</p>' +
        '<button type="button" class="btn btn-primary pr-groups-btn">Sign in</button></div>';
      root.querySelector('.pr-groups-btn').onclick = openLogin;
      return;
    }

    root.innerHTML = '<div class="pr-groups-loading">Loading groups…</div>';

    try {
      var mine = await apiGet('/api/groups/my');
      var myGroups = (mine && mine.groups) || [];
      var pub = { groups: [] };
      try {
        pub = await apiGet('/api/groups');
      } catch (e) {
        /* public list optional */
      }
      var publicGroups = (pub && pub.groups) || [];
      var memberIds = {};
      myGroups.forEach(function (g) {
        memberIds[g.group_id] = true;
      });
      var discover = publicGroups.filter(function (g) {
        return !memberIds[g.group_id];
      });

      var html = '';

      html += '<div class="pr-groups-toolbar">';
      html +=
        '<button type="button" class="btn btn-secondary pr-groups-btn" id="pr-groups-show-create">Create group</button>';
      html += '</div>';

      html += '<div class="pr-groups-join-row">';
      html +=
        '<input type="text" id="pr-groups-invite-input" class="pr-groups-input" placeholder="Invite code" maxlength="16" autocomplete="off" />';
      html +=
        '<button type="button" class="btn btn-primary pr-groups-btn" id="pr-groups-join-code">Join with code</button>';
      html += '</div>';
      html += '<p id="pr-groups-join-msg" class="pr-groups-msg" role="status"></p>';

      html += '<h3 class="pr-groups-section-title">My groups</h3>';
      if (!myGroups.length) {
        html += '<p class="pr-groups-muted">You are not in any group yet. Create one or join with a code.</p>';
      } else {
        html += '<div class="pr-groups-cards">';
        myGroups.forEach(function (g) {
          html += groupCardHtml(g, true);
        });
        html += '</div>';
      }

      if (discover.length) {
        html += '<h3 class="pr-groups-section-title">Discover</h3>';
        html += '<div class="pr-groups-cards">';
        discover.forEach(function (g) {
          html += groupCardHtml(g, false);
        });
        html += '</div>';
      }

      root.innerHTML = html;

      root.querySelector('#pr-groups-show-create').onclick = function () {
        showCreateModal();
      };
      root.querySelector('#pr-groups-join-code').onclick = function () {
        joinByCodeFromInput();
      };

      root.querySelectorAll('[data-pr-group-open]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-pr-group-open');
          var name = btn.getAttribute('data-pr-group-name') || 'Group';
          openGroupDetail(id, name);
        });
      });

      root.querySelectorAll('[data-pr-group-join]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-pr-group-join');
          joinPublicGroup(id);
        });
      });
    } catch (e) {
      root.innerHTML =
        '<div class="pr-groups-card pr-groups-error">' + esc(e.message || 'Could not load groups') + '</div>';
    }
  }

  function groupCardHtml(g, isMember) {
    var id = esc(g.group_id);
    var name = esc(g.name || 'Group');
    var desc = g.description ? '<p class="pr-groups-card-desc">' + esc(g.description) + '</p>' : '';
    var count = typeof g.member_count === 'number' ? g.member_count : (g.member_ids && g.member_ids.length) || 0;
    var actions = isMember
      ? '<button type="button" class="btn btn-secondary pr-groups-btn-sm" data-pr-group-open="' +
        id +
        '" data-pr-group-name="' +
        name +
        '">Open</button>'
      : '<button type="button" class="btn btn-primary pr-groups-btn-sm" data-pr-group-join="' +
        id +
        '">Join</button>';
    return (
      '<div class="pr-groups-card">' +
      '<div class="pr-groups-card-head"><span class="pr-groups-card-title">' +
      name +
      '</span><span class="pr-groups-badge">' +
      count +
      ' members</span></div>' +
      desc +
      '<div class="pr-groups-card-actions">' +
      actions +
      '</div></div>'
    );
  }

  async function joinByCodeFromInput() {
    var input = $('pr-groups-invite-input');
    var msg = $('pr-groups-join-msg');
    if (!input || !msg) return;
    var code = (input.value || '').trim().toUpperCase();
    if (!code) {
      msg.textContent = 'Enter an invite code.';
      return;
    }
    msg.textContent = '';
    try {
      await apiPost('/api/groups/join-by-code', { code: code });
      msg.textContent = 'Joined successfully.';
      input.value = '';
      await renderListView();
    } catch (e) {
      msg.textContent = e.message || 'Could not join.';
    }
  }

  async function joinPublicGroup(groupId) {
    try {
      await apiPost('/api/groups/' + encodeURIComponent(groupId) + '/join', {});
      await renderListView();
    } catch (e) {
      alert(e.message || 'Could not join group.');
    }
  }

  function showCreateModal() {
    var backdrop = $('pr-groups-create-modal');
    if (!backdrop) return;
    backdrop.style.display = 'flex';
    var name = $('pr-groups-create-name');
    var desc = $('pr-groups-create-desc');
    if (name) name.value = '';
    if (desc) desc.value = '';
    $('pr-groups-create-msg').textContent = '';
  }

  function hideCreateModal() {
    var m = $('pr-groups-create-modal');
    if (m) m.style.display = 'none';
  }

  async function submitCreateGroup() {
    var nameEl = $('pr-groups-create-name');
    var descEl = $('pr-groups-create-desc');
    var msg = $('pr-groups-create-msg');
    var name = (nameEl && nameEl.value.trim()) || '';
    var description = (descEl && descEl.value.trim()) || '';
    if (name.length < 3) {
      if (msg) msg.textContent = 'Name must be at least 3 characters.';
      return;
    }
    if (msg) msg.textContent = '';
    try {
      await apiPost('/api/groups', {
        name: name,
        description: description,
        privacy: 'private',
      });
      hideCreateModal();
      await renderListView();
    } catch (e) {
      if (msg) msg.textContent = e.message || 'Could not create group.';
    }
  }

  async function openGroupDetail(groupId, fallbackName) {
    var root = $('pr-groups-list-root');
    var detail = $('pr-groups-detail-root');
    if (!root || !detail) return;
    leaveChatListener();
    root.style.display = 'none';
    detail.style.display = 'block';
    detail.innerHTML = '<div class="pr-groups-loading">Loading…</div>';

    try {
      var data = await apiGet('/api/groups/' + encodeURIComponent(groupId));
      var g = data.group;
      if (!g) throw new Error('Group not found');
      selectedGroup = g;

      var uid = currentUser && currentUser.uid;
      var isMember = uid && (g.member_ids || []).indexOf(uid) !== -1;
      var isCreator = uid && g.created_by === uid;
      var name = esc(g.name || fallbackName || 'Group');
      var count = typeof g.member_count === 'number' ? g.member_count : (g.member_ids && g.member_ids.length) || 0;
      var code = g.invite_code ? String(g.invite_code).toUpperCase() : '';

      var html = '';
      html +=
        '<div class="pr-groups-detail-top"><button type="button" class="btn btn-secondary pr-groups-btn-sm" id="pr-groups-back">← Back</button></div>';
      html += '<div class="pr-groups-detail-header"><h2 class="pr-groups-detail-title">' + name + '</h2>';
      html +=
        '<p class="pr-groups-muted">' +
        count +
        ' members · ' +
        esc(g.privacy || 'private') +
        '</p></div>';

      if (isMember) {
        html += '<div class="pr-groups-action-row">';
        html +=
          '<button type="button" class="btn btn-primary pr-groups-btn" id="pr-groups-live">Join live group prayer</button>';
        if (code) {
          html +=
            '<button type="button" class="btn btn-secondary pr-groups-btn" id="pr-groups-copy-invite">Copy invite link</button>';
        }
        html += '</div>';
        if (code) {
          html +=
            '<p class="pr-groups-muted pr-groups-code-hint">Invite code: <strong>' +
            esc(code) +
            '</strong></p>';
        }
      } else {
        html += '<p class="pr-groups-muted">You are not a member of this group.</p>';
      }

      if (isMember && !isCreator) {
        html +=
          '<p class="pr-groups-leave-wrap"><button type="button" class="btn btn-secondary pr-groups-btn-sm" id="pr-groups-leave">Leave group</button></p>';
      }
      if (isCreator) {
        html +=
          '<p class="pr-groups-muted">As the creator, you can manage the group from the mobile app. Leaving the group from the web is not supported yet.</p>';
      }

      html += '<h3 class="pr-groups-section-title">Group chat</h3>';
      if (!isMember) {
        html += '<p class="pr-groups-muted">Join this group to see and send messages.</p>';
      } else {
        html += '<div id="pr-groups-chat-log" class="pr-groups-chat-log"></div>';
        html += '<div class="pr-groups-chat-compose">';
        html += '<div class="pr-groups-chat-extras">';
        html +=
          '<button type="button" class="btn btn-secondary pr-groups-btn-sm" id="pr-groups-attach-file">Attach file</button>';
        html +=
          '<button type="button" class="btn btn-secondary pr-groups-btn-sm" id="pr-groups-attach-link">Add link</button>';
        html += '</div>';
        html +=
          '<input type="file" id="pr-groups-file-input" accept="image/*,application/pdf" tabindex="-1" aria-hidden="true" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none" />';
        html += '<div class="pr-groups-chat-compose-row">';
        html +=
          '<input type="text" id="pr-groups-chat-input" class="pr-groups-input pr-groups-chat-input" maxlength="2000" placeholder="Write a message (optional caption for files/links)…" autocomplete="off" />';
        html +=
          '<button type="button" class="btn btn-primary pr-groups-btn" id="pr-groups-chat-send">Send</button>';
        html += '</div>';
        html += '<div id="pr-groups-link-overlay" class="pr-groups-link-overlay" style="display:none">';
        html += '<div class="pr-groups-link-box">';
        html += '<p class="pr-groups-link-title">Add a link</p>';
        html +=
          '<input type="url" id="pr-groups-link-url-input" class="pr-groups-input" placeholder="https://…" autocomplete="off" />';
        html += '<div class="pr-groups-link-actions">';
        html += '<button type="button" class="btn btn-secondary" id="pr-groups-link-cancel">Cancel</button>';
        html += '<button type="button" class="btn btn-primary" id="pr-groups-link-send">Send</button>';
        html += '</div></div></div>';
        html += '</div>';
      }

      detail.innerHTML = html;

      detail.querySelector('#pr-groups-back').onclick = function () {
        leaveChatListener();
        selectedGroup = null;
        detail.style.display = 'none';
        detail.innerHTML = '';
        root.style.display = 'block';
        renderListView().catch(function () {});
      };

      var copyBtn = detail.querySelector('#pr-groups-copy-invite');
      if (copyBtn && code) {
        copyBtn.onclick = function () {
          var path = '/join/' + encodeURIComponent(groupId) + '?code=' + encodeURIComponent(code);
          var url = window.location.origin + path;
          navigator.clipboard.writeText(url).then(
            function () {
              copyBtn.textContent = 'Copied!';
              setTimeout(function () {
                copyBtn.textContent = 'Copy invite link';
              }, 2000);
            },
            function () {
              prompt('Copy this link:', url);
            }
          );
        };
      }

      var liveBtn = detail.querySelector('#pr-groups-live');
      if (liveBtn) {
        liveBtn.onclick = function () {
          startGroupLive(groupId);
        };
      }

      var leaveBtn = detail.querySelector('#pr-groups-leave');
      if (leaveBtn) {
        leaveBtn.onclick = async function () {
          if (!confirm('Leave this group?')) return;
          try {
            await apiPost('/api/groups/' + encodeURIComponent(groupId) + '/leave', {});
            leaveChatListener();
            detail.style.display = 'none';
            detail.innerHTML = '';
            root.style.display = 'block';
            await renderListView();
          } catch (e) {
            alert(e.message || 'Could not leave.');
          }
        };
      }

      if (isMember) {
        attachChat(groupId);
        var sendBtn = $('pr-groups-chat-send');
        var input = $('pr-groups-chat-input');
        var fileInput = $('pr-groups-file-input');
        var attachFileBtn = $('pr-groups-attach-file');
        var attachLinkBtn = $('pr-groups-attach-link');
        var linkOverlay = $('pr-groups-link-overlay');
        var linkUrlInput = $('pr-groups-link-url-input');
        var linkCancel = $('pr-groups-link-cancel');
        var linkSend = $('pr-groups-link-send');
        var linkBox = linkOverlay && linkOverlay.querySelector('.pr-groups-link-box');

        function caption() {
          return (input && input.value.trim()) || '';
        }

        function send() {
          var t = caption();
          if (!t) return;
          postGroupMessage(groupId, t, {});
          if (input) input.value = '';
        }

        if (sendBtn) sendBtn.onclick = send;
        if (input) {
          input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              send();
            }
          });
        }

        if (attachFileBtn && fileInput) {
          attachFileBtn.onclick = function () {
            fileInput.value = '';
            fileInput.click();
          };
          fileInput.addEventListener('change', function () {
            var f = fileInput.files && fileInput.files[0];
            if (!f) return;
            void (async function () {
              try {
                var att = await uploadGroupChatFileWeb(groupId, f);
                await postGroupMessage(groupId, caption(), { attachments: [att] });
                if (input) input.value = '';
              } catch (err) {
                alert(err.message || 'Upload failed');
              }
              fileInput.value = '';
            })();
          });
        }

        if (attachLinkBtn && linkOverlay) {
          attachLinkBtn.onclick = function () {
            if (linkUrlInput) linkUrlInput.value = '';
            linkOverlay.style.display = 'flex';
          };
        }
        if (linkOverlay) {
          linkOverlay.addEventListener('click', function () {
            linkOverlay.style.display = 'none';
          });
        }
        if (linkBox) {
          linkBox.addEventListener('click', function (e) {
            e.stopPropagation();
          });
        }
        if (linkCancel && linkOverlay) {
          linkCancel.onclick = function () {
            linkOverlay.style.display = 'none';
          };
        }
        if (linkSend && linkOverlay && linkUrlInput) {
          linkSend.onclick = function () {
            var u = normalizeHttpsUrl(linkUrlInput.value);
            if (!u) {
              alert('Enter a valid web address (https).');
              return;
            }
            void (async function () {
              try {
                await postGroupMessage(groupId, caption(), { linkUrl: u });
                linkUrlInput.value = '';
                linkOverlay.style.display = 'none';
                if (input) input.value = '';
              } catch (err) {
                alert(err.message || 'Could not send');
              }
            })();
          };
        }
      }
    } catch (e) {
      detail.innerHTML =
        '<div class="pr-groups-card pr-groups-error">' +
        esc(e.message || 'Error') +
        ' <button type="button" class="btn btn-secondary pr-groups-btn-sm" id="pr-groups-back-err">Back</button></div>';
      var b = $('pr-groups-back-err');
      if (b) {
        b.onclick = function () {
          detail.style.display = 'none';
          detail.innerHTML = '';
          root.style.display = 'block';
          renderListView().catch(function () {});
        };
      }
    }
  }

  async function startGroupLive(groupId) {
    var btn = $('pr-groups-live');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Starting…';
    }
    try {
      var res = await apiPost('/api/prayer-room/group-session', { group_id: groupId });
      var roomId = res.room_id;
      var roomName = res.room_name || 'Group prayer';
      if (!roomId) throw new Error('No room returned');
      var q =
        '/prayer-room/join?room=' +
        encodeURIComponent(roomId) +
        '&name=' +
        encodeURIComponent(roomName);
      window.location.href = q;
    } catch (e) {
      alert(e.message || 'Could not start live prayer.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Join live group prayer';
      }
    }
  }

  function attachChat(groupId) {
    leaveChatListener();
    var db = getDb();
    var logEl = $('pr-groups-chat-log');
    if (!db || !logEl) return;

    var ref = db.collection(COLLECTION).doc(groupId).collection('messages').limit(100);

    unsubChat = ref.onSnapshot(
      function (snap) {
        var rows = snap.docs
          .map(function (d) {
            return { id: d.id, data: d.data() };
          })
          .sort(function (a, b) {
            return tsMs(a.data.timestamp) - tsMs(b.data.timestamp);
          });

        var uid = currentUser && currentUser.uid;
        logEl.innerHTML = rows
          .map(function (row) {
            var m = row.data;
            var mine = uid && m.user_id === uid;
            var who = esc(m.user_name || 'Member');
            var body = '';
            if (m.link_url) {
              var lu = esc(m.link_url);
              body +=
                '<a class="pr-groups-embed-link" href="' +
                lu +
                '" target="_blank" rel="noopener noreferrer">' +
                lu +
                '</a>';
            }
            var atts = m.attachments;
            if (atts && atts.length) {
              for (var ai = 0; ai < atts.length; ai++) {
                var a = atts[ai];
                if (!a || !a.url) continue;
                var au = esc(a.url);
                var fn = esc(a.file_name || 'File');
                if (a.content_type && String(a.content_type).indexOf('image/') === 0) {
                  body +=
                    '<a href="' +
                    au +
                    '" target="_blank" rel="noopener noreferrer"><img class="pr-groups-embed-img" src="' +
                    au +
                    '" alt="' +
                    fn +
                    '" /></a>';
                } else {
                  body +=
                    '<a class="pr-groups-embed-pdf" href="' +
                    au +
                    '" target="_blank" rel="noopener noreferrer">PDF · ' +
                    fn +
                    '</a>';
                }
              }
            }
            var msgText = (m.message && String(m.message).trim()) || '';
            if (msgText) {
              body += '<div class="pr-groups-msg-text">' + esc(msgText) + '</div>';
            }
            var cls = mine ? 'pr-groups-msg-row mine' : 'pr-groups-msg-row';
            return '<div class="' + cls + '"><span class="pr-groups-msg-who">' + who + '</span>' + body + '</div>';
          })
          .join('');

        logEl.scrollTop = logEl.scrollHeight;
      },
      function (err) {
        console.error('Group chat listener:', err);
        logEl.innerHTML =
          '<p class="pr-groups-error">Could not load chat. Check your connection and Firestore rules.</p>';
      }
    );
  }

  async function postGroupMessage(groupId, messageStr, extras) {
    var db = getDb();
    if (!db || !currentUser) return;
    var body = (messageStr || '').trim();
    var link = extras && extras.linkUrl && String(extras.linkUrl).trim();
    var atts = (extras && extras.attachments) || [];
    if (!body && !link && (!atts || !atts.length)) return;
    try {
      var doc = {
        user_id: currentUser.uid,
        user_name: displayName(),
        user_photo: currentUser.photoURL || null,
        message: body,
        message_type: 'text',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        reactions: {},
        read_by: [currentUser.uid],
      };
      if (link) doc.link_url = link;
      if (atts && atts.length) doc.attachments = atts;
      await db.collection(COLLECTION).doc(groupId).collection('messages').add(doc);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Could not send message.');
    }
  }

  function onTabGroupsClick(ev) {
    if (ev) ev.preventDefault();
    if (!currentUser) {
      openLogin();
      return;
    }
    setTab('groups');
  }

  function onTabFeedClick(ev) {
    if (ev) ev.preventDefault();
    setTab('feed');
  }

  function bind() {
    var tG = $('pr-tab-groups');
    var tF = $('pr-tab-feed');
    if (tG) tG.addEventListener('click', onTabGroupsClick);
    if (tF) tF.addEventListener('click', onTabFeedClick);

    var modal = $('pr-groups-create-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) hideCreateModal();
      });
    }
    var closeC = $('pr-groups-create-close');
    if (closeC) closeC.onclick = hideCreateModal;
    var submitC = $('pr-groups-create-submit');
    if (submitC) submitC.onclick = submitCreateGroup;

    window.addEventListener('hashchange', function () {
      syncTabToLocation();
    });
    window.addEventListener('pageshow', function (ev) {
      if (ev.persisted) {
        syncTabToLocation();
      }
    });
  }

  function init() {
    bind();
    syncTabToLocation();
    void tryConsumeJoinIntent();
  }

  window.PrayerRoomGroups = {
    init: init,
    setTab: setTab,
    syncTabToLocation: syncTabToLocation,
    tryConsumeJoinIntent: tryConsumeJoinIntent,
    refresh: scheduleListRefresh,
  };
})();
