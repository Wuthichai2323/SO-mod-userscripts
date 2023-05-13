// ==UserScript==
// @name         Suspicious Voting Helper
// @description  Assists in building suspicious votes CM messages. Highlight same users across IPxref table. Also provides support for SEDE query https://data.stackexchange.com/stackoverflow/query/968803
// @homepage     https://github.com/samliew/SO-mod-userscripts
// @author       Samuel Liew
// @version      3.4.1
//
// @match        https://*.stackoverflow.com/*
// @match        https://*.serverfault.com/*
// @match        https://*.superuser.com/*
// @match        https://*.askubuntu.com/*
// @match        https://*.mathoverflow.net/*
// @match        https://*.stackapps.com/*
// @match        https://*.stackexchange.com/*
//
// @exclude      https://stackoverflowteams.com/*
// @exclude      https://api.stackexchange.com/*
// @exclude      https://data.stackexchange.com/*
// @exclude      https://contests.stackoverflow.com/*
// @exclude      https://winterbash*.stackexchange.com/*
// @exclude      *chat.*
// @exclude      *blog.*
// @exclude      */tour
//
// @require      https://raw.githubusercontent.com/samliew/SO-mod-userscripts/master/lib/se-ajax-common.js
// @require      https://raw.githubusercontent.com/samliew/SO-mod-userscripts/master/lib/common.js
// ==/UserScript==

/* globals StackExchange */
/// <reference types="./globals" />

'use strict';

// This is a moderator-only userscript
if (!isModerator()) return;

const apikey = 'yZcUvuGAMj25rYZ)a5YNqg((';
const newlines = '\n\n';


// jQuery mapping functions to build object from table rows in votes tables page for suspicious votes canned message
function mapVotePatternItemsToObject() {
  const link = $('.user-details a', this);
  const uRep = $('.reputation-score', this);
  const vArr = $(this).children('td').eq(2).text().split(' / ');
  const vNum = Number(vArr[0]);
  const vTotal = Number(vArr[1]);
  const vtype = $(this).children('td').eq(1).text().trim();
  const vtypeText = vtype === 'dn' ? 'down' : (vtype === 'up' ? 'up' : 'acc');
  const vPct = Math.round(vNum / vTotal * 100);
  return link.length == 0 ? null : {
    uid: link.attr('href').match(/\/(-?\d+)\//)[0],
    userlink: link.attr('href'),
    username: link.text(),
    userrep: strToRep(uRep.text()),
    type: vtypeText,
    votes: vNum,
    votesTotal: vTotal,
    votesPct: vPct,
    size: (vNum >= 10 || vPct >= 25) ? 'large' : '',
    used: false,
  }
}
function mapInvVotePatternItemsToObject() {
  const link = $('.user-details a', this);
  const uRep = $('.reputation-score', this);
  const vNum = Number($(this).children('td').eq(1).text());
  return link.length == 0 ? null : {
    uid: link.attr('href').match(/\/(\d+)\//)[0],
    userlink: link.attr('href'),
    username: link.text(),
    userrep: strToRep(uRep.text()),
    type: 'invalidated ',
    votes: vNum,
    votesTotal: vNum,
    votesPct: '',
    size: vNum >= 5 ? 'large' : '',
    used: false,
  }
}


// Main functions
// After CM message template dialog has loaded/opened
let updateModTemplates = function () {
  updateModTemplates = () => 0; // this function should run once only

  const uid = currentUserId;
  const userlink = $('.userlink a').filter((i, el) => el.href.includes(`/${uid}/`)).first();
  const template = $('.popup input[name=mod-template]').filter((i, el) => $(el).next().text().includes('suspicious voting'));

  let prefixString = `This user has a [suspicious history](${location.origin}/admin/show-user-votes/${uid}) of cross-voting and/or targeted votes.` + newlines;
  let appendString = `*(there may also be other minor instances of targeted votes that are unknown to us, as we can only view votes between users if they are above a certain threshold)*`;
  let additionalInfo = getQueryParam('info');

  let flags, votesFrom, votesTo, votesFromInv = [], votesToInv = [];
  $.when(

    // Load latest flagged posts and get mod flags that suggest suspicious voting
    $.get(`${location.origin}/users/flagged-posts/${uid}`).then(function (data) {
      flags = $('#mainbar .mod-flag', data);

      // Format flags
      flags = flags.filter(function (i, el) {
        return $(el).find('.flag-outcome').length == 0 &&
          /\b((up|down)?vot(es?|ing)|sock|revenge|serial|suspicious)/.test($(el).find('.revision-comment').text());
      })
        .each(function (i, el) {
          $(el).find('a').each(function () { this.innerText = this.href; });
          $(el).find('.relativetime').each(function () { this.innerText = '*' + this.title + '*'; });
          $(el).find('.mod-flag-indicator').remove();
        })
        .get().map(v => v.innerText
          .replace(/\s*(\n|\r)\s*/g, ' ') // remove excessive whitespace
          .replace(/\s*[|]\s*/g, '<br>\n') // convert pipes to newlines
          .replace(/\s*([‒–—―])/g, '<br>\n$1') // add newlines before hyphens
          .replace(/\b((\d{1,2} )?[a-z]{3} (\d{1,2})?,? (\d{4}|'\d{2}))\b/gi, '**$1**') // bold dates
          .replace(' site://', ' https://' + location.hostname + '/') // convert SEDE site:// links to proper urls
          .trim()
        );
    }),

    // Load votes
    $.get(`${location.origin}/admin/show-user-votes/${uid}`).then(function (data) {
      const sections = $('#mainbar-full [class*="md:fd-column"]', data);

      const tables = sections.first().find('table');
      votesFrom = tables.first().find('tbody tr').map(mapVotePatternItemsToObject).get();
      votesTo = tables.last().find('tbody tr').map(mapVotePatternItemsToObject).get();

      if (sections.length > 1) {
        const tablesInv = sections.last().find('table');
        votesFromInv = tablesInv.first().find('tbody tr').map(mapInvVotePatternItemsToObject).get();
        votesToInv = tablesInv.last().find('tbody tr').map(mapInvVotePatternItemsToObject).get();
      }
    })

  ).then(function () {

    //console.log(flags);
    //console.table(votesFrom);
    //console.table(votesTo);
    //console.table(votesFromInv);
    //console.table(votesToInv);

    // Build evidence
    let evidence = `Please investigate the votes shared between these users:` + newlines;

    // Check for users in the four vote tables
    votesFrom.forEach(function (v, i) {

      for (let i = 0; i < votesTo.length; i++) {
        if (v.uid === votesTo[i].uid && v.type !== 'acc' && votesTo[i].type !== 'acc') {
          evidence += `- Although this user has both received ${v.votes} ${v.type}votes from, and given ${votesTo[i].votes} ${votesTo[i].type}votes to [${v.username}](${v.userlink}),
it doesn't seem that this account is a sockpuppet due to different PII and are most likely studying/working together.` + newlines;

          // Invalidate used entries
          v.used = true;
          votesTo[i].used = true;
          return;
        }
      }

      // Also check for already invalidated votes
      for (let i = 0; i < votesToInv.length; i++) {
        if (v.uid === votesToInv[i].uid && v.type !== 'acc') {
          evidence += `- Although this user has both received ${v.votes} ${v.type}votes from, and previously given ${votesToInv[i].votes} *invalidated* votes to [${v.username}](${v.userlink}),
it doesn't seem that this account is a sockpuppet due to different PII and are most likely studying/working together.` + newlines;

          // Invalidate used entries
          v.used = true;
          votesToInv[i].used = true;
          return;
        }
      }
    });

    // Get users with high vote ratio
    votesFrom.filter(v => !v.used).forEach(function (v, i) {
      if (v.votesPct >= 50 && v.type !== 'acc' && v.userrep < 100000) {

        let temp = `- This user has received a ${v.size} percentage of targeted ${v.type}votes (${v.votes}/${v.votesTotal} **${v.votesPct}%**) from [${v.username}](${v.userlink})`;

        // Targeted and targeted invalidated
        for (let i = 0; i < votesFromInv.length; i++) {
          if (v.uid === votesFromInv[i].uid) {
            evidence += temp + ` *(some votes are already invalidated)*.` + newlines;

            // Invalidate used entries
            v.used = true;
            return;
          }
        }

        // No targeted (default)
        evidence += temp + '.' + newlines;
        v.used = true;
      }
    });
    votesTo.filter(v => !v.used).forEach(function (v, i) {
      if (v.votesPct >= 50 && v.type !== 'acc' && v.userrep < 100000) {
        evidence += `- This user has given a ${v.size} percentage of targeted ${v.type}votes (${v.votes}/${v.votesTotal} **${v.votesPct}%**) to [${v.username}](${v.userlink}).` + newlines;
        v.used = true;
      }
    });

    // Get users with >= 5 targeted votes
    votesFrom.filter(v => !v.used).forEach(function (v, i) {
      if (v.votes >= 5 && v.type !== 'acc' && v.userrep < 100000) {

        let temp = `- This user has received a ${v.size} number of targeted ${v.type}votes (**${v.votes}**/${v.votesTotal} *${v.votesPct}%*) from [${v.username}](${v.userlink})`;

        // Targeted and targeted invalidated
        for (let i = 0; i < votesFromInv.length; i++) {
          if (v.uid === votesFromInv[i].uid) {
            evidence += temp + ` *(some votes are already invalidated)*.` + newlines;

            // Invalidate used entries
            v.used = true;
            return;
          }
        }

        // No targeted (default)
        evidence += temp + '.' + newlines;
        v.used = true;
      }
    });
    votesTo.filter(v => !v.used).forEach(function (v, i) {
      if (v.votes >= 5 && v.type !== 'acc' && v.userrep < 100000) {
        evidence += `- This user has given a ${v.size} number of targeted ${v.type}votes (**${v.votes}**/${v.votesTotal} *${v.votesPct}%*) to [${v.username}](${v.userlink}).` + newlines;
        v.used = true;
      }
    });

    // Display flags from users
    if (flags.length > 0) {
      let flagText = `\nReported via [custom flag](${location.origin}/users/flagged-posts/${uid}):\n\n`;
      flags.forEach(function (v) {
        flagText += '> ' + v + newlines;
      });

      appendString = flagText + newlines + appendString;
    }

    // Additional information from querystring, mostly for use with
    // https://data.stackexchange.com/stackoverflow/query/968803 (original)
    // https://data.stackexchange.com/stackoverflow/query/1464298 (latest)
    if (additionalInfo) {
      let infotext = `Additional information:` + newlines + ' - ' + decodeURIComponent(additionalInfo) + newlines;
      appendString = infotext + newlines + appendString;
    }

    // Insert to CM suspicious voting template
    prefixString += evidence;
    template.val(
      template.val()
        .replace(/:\n/, ':<br>') // remove newline after :
        .replace(/(https[^\s]+)/, '$1?tab=reputation') // change userlink to rep tab
        .replace(/\n\n{todo}/, prefixString + appendString) // replace todo with evidence
    );

    // Show help message if template selected
    var selBtn = template.closest('.popup').find('.popup-submit');
    selBtn.on('click', function () {
      if (template.is(':checked')) {
        StackExchange.helpers.showMessage(
          $('#show-templates').parent(),
          'Ensure confirmed socks (matching IP & PII) are deleted first before using this template. Then, in this canned message, remove users that are not cross or targeted voting.'
        );
      }
    });

    // Finally select the template option if we are automating via query params
    if (getQueryParam('action') == 'suspicious-voting') {
      template.trigger('click');
      selBtn.removeAttr('disabled').trigger('click');

      // Failsafe
      $('#templateName').val('suspicious voting');
    }

  }); // End then
}


function doPageLoad() {

  // If on xref-user-ips page
  if (location.pathname.includes('/admin/xref-user-ips/')) {
    const svhActiveClass = 'svh-active';
    const svhFocusClass = 'svh-focus';
    const svhCurrUserClass = 'svh-curruser';

    // Populate each user row with their uid
    const userRows = $('#xref-ids td tbody tr')
      .each(function () {
        this.dataset.uid = this.querySelector('a')?.href?.match(/\d+$/)[0];
      })

      // Highlight same user across IPs
      .on('mouseover', function () {
        const uid = this.dataset.uid;
        userRows.removeClass(svhActiveClass).filter(`[data-uid=${uid}]`).addClass(svhActiveClass);
      })
      .on('mouseout', function () {
        userRows.removeClass(svhActiveClass);
      })

      // Pin highlight on clicked user
      .on('click', function (evt, currUser) {
        const uid = this.dataset.uid;
        const isFocus = $(this).hasClass(svhFocusClass);
        userRows.removeClass('focus');
        if (currUser) userRows.filter(`[data-uid=${uid}]`).addClass(svhCurrUserClass);
        if (!isFocus) userRows.filter(`[data-uid=${uid}]`).addClass(svhFocusClass);
      });

    // Select current user on page load
    const currUid = location.pathname.split('/').pop() || '';
    $(`a[href$="/users/${currUid}"]`).first().closest('tr').triggerHandler('click', true);

    // Fix compare links that are on the same date, so we don't get the "to date precedes or equal to start date" error
    $('a[href^="/admin/user-activity"]').each(function () {
      const [date1, date2, users] = this.href.split('#')[1].split('|');

      if (date1 === date2) {
        let y = Number(date1.split('/')[0]);
        let m = Number(date1.split('/')[1]);
        let d = Number(date1.split('/')[2]) - 1;
        if (d < 0) {
          d = 31;
          m -= 1;

          if (m < 0) {
            m = 12;
            y -= 1;
          }
        }
        this.href = `/admin/user-activity#${y}/${m}/${d}|${date2}|${users}`;
      }
    });

    // Move rows that only contain a single user to the bottom
    $('.odd, .even', '#xref-ids').removeClass('even odd').addClass('ip-group');
    const singleUserRows = $('.ip-address').next('td').children('table').filter(function () { return $(this).find('tr').length == 1 }).parents('.ip-group').addClass('single-user');
    singleUserRows.reverse().appendTo('#xref-ids > tbody');
  }

  // If on user votes page
  else if (location.pathname.includes('/show-user-votes/')) {
    const svhSortClass = 'bg-yellow-100';

    function _sortByUser(a, b) {
      let aRow = a.closest('tr'), bRow = b.closest('tr');
      if (aRow.children.length === 3 || bRow.children.length === 3) return 0;

      let aVal = a.querySelector('.user-details a').innerText,
        bVal = b.querySelector('.user-details a').innerText;

      if (aVal === bVal) return 0;
      return (aVal > bVal) ? 1 : -1;
    }

    function _sortByType(a, b) {
      let aRow = a.closest('tr'), bRow = b.closest('tr');
      if (aRow.children.length === 3 || bRow.children.length === 3) return 0;

      let aVal = a.querySelector('.ta-center span').innerText,
        bVal = b.querySelector('.ta-center span').innerText;

      if (aVal === bVal) return 0;
      return (aVal < bVal) ? 1 : -1;
    };

    function _sortByVotes(a, b) {
      let aRow = a.closest('tr'), bRow = b.closest('tr');
      if (aRow.children.length === 3 || bRow.children.length === 3) return 0;

      let aVal = Number(a.children[2].innerText.match(/\d+/)[0]),
        bVal = Number(b.children[2].innerText.match(/\d+/)[0]);
      //console.log(a.children[2].innerText, aVal);

      if (aVal === bVal) return 0;
      return (aVal < bVal) ? 1 : -1;
    };

    function _sortByPerc(a, b) {
      let aRow = a.closest('tr'), bRow = b.closest('tr');
      if (aRow.children.length === 3 || bRow.children.length === 3) return 0;

      let aVal = Number(a.querySelector('.ta-right[title] span')?.innerText.replace('%', '')) || 0,
        bVal = Number(b.querySelector('.ta-right[title] span')?.innerText.replace('%', '')) || 0;

      if (aVal === bVal || isNaN(aVal) || isNaN(bVal)) return 0;
      return (aVal < bVal) ? 1 : -1;
    };

    function _sortByNum(a, b) {
      let aRow = a.closest('tr'), bRow = b.closest('tr');
      if (aRow.children.length === 3 || bRow.children.length === 3) return 0;

      let aVal = Number(a.children[1].innerText.match(/\d+/)[0]),
        bVal = Number(b.children[1].innerText.match(/\d+/)[0]);

      if (aVal === bVal) return 0;
      return (aVal < bVal) ? 1 : -1;
    };

    function _sortByDate(a, b) {
      let aRow = a.closest('tr'), bRow = b.closest('tr');
      if (aRow.children.length === 3 || bRow.children.length === 3) return 0;

      let aVal = new Date(a.querySelector('.relativetime').title),
        bVal = new Date(b.querySelector('.relativetime').title);

      if (aVal === bVal) return 0;
      return (aVal < bVal) ? 1 : -1;
    };

    const sections = $('#mainbar-full > div');
    const activeVotesTables = sections.eq(0).find('table');
    const invalidatedVotesTables = sections.eq(1).find('table');

    // Show all users
    activeVotesTables.find('tr.d-none').removeClass('d-none');
    invalidatedVotesTables.find('tr.d-none').removeClass('d-none');

    // Table header click event
    activeVotesTables.on('click', 'th', function () {
      const thIndex = $(this).index();
      const sortFunction = [_sortByUser, _sortByType, _sortByVotes, _sortByPerc, null][thIndex];
      if (!sortFunction) return;

      // Toggle sort class
      $(this).addClass(svhSortClass).siblings().removeClass(svhSortClass);

      // Sort posts in-memory then reattach to container
      const tbody = $(this).closest('table').find('tbody');
      const rows = tbody.children();
      rows.sort(sortFunction).detach().appendTo(tbody);

      // Some rows only contain three cells, re-insert them after the row with the same [data-user-id]
      rows.filter(function () { return this.children.length === 3 }).each(function () {
        const userId = this.dataset.userId;
        const matchedRow = rows.not(this).filter(function () { return this.dataset.userId === userId }).first();
        if (matchedRow.length) matchedRow.after(this);
      });

      return false;
    });

    // Sort activeVotesTables by given by default
    activeVotesTables.each(function () {
      $(this).find('th').eq(2).addClass(svhSortClass);
    });

    // Table header click event
    invalidatedVotesTables.on('click', 'th', function () {
      const thIndex = $(this).index();
      const sortFunction = [_sortByUser, _sortByNum, _sortByDate, null][thIndex];
      if (!sortFunction) return;

      // Toggle sort class
      $(this).addClass(svhSortClass).siblings().removeClass(svhSortClass);

      // Sort posts in-memory then reattach to container
      const tbody = $(this).closest('table').find('tbody');
      const rows = tbody.children();
      rows.sort(sortFunction).detach().appendTo(tbody);

      return false;
    });

    // Sort invalidatedVotesTables by date by default
    invalidatedVotesTables.each(function () {
      $(this).find('th').eq(2).trigger('click');
    });
  }

  // CM message page
  else if (location.pathname.includes('/admin/cm-message/')) {

    // Linkify user ids in preformatted elements
    const uidRegex = /\b(\d{4,})\b/g;
    $('.msg-body pre code').each(function () {
      this.innerHTML = this.innerHTML.replace(uidRegex, `<a href="${location.origin}/users/$1" target="_blank">$1</a>`);
    });

    // click template link if we are automating via query params
    if (getQueryParam('action') == 'suspicious-voting') {
      $('#show-templates').trigger('click');
    }
  }

  // User dashboard
  else if (location.pathname.includes('/users/account-info/')) {
    const networkUid = $('.account-info a[href^="https://stackexchange.com/users/"]').attr('href').match(/\/(\d+)\/?/)[1];

    const dateNetworkRegContainer = $(` <span class="d-inline-block ml12"></span>`);
    $('#mod-content .details .col-4').eq(0).append(dateNetworkRegContainer);

    const dateSiteRegContainer = $(` <span class="d-inline-block ml12"></span>`);
    $('#mod-content .details .col-4').eq(1).append(dateSiteRegContainer);

    // Fetch network accounts info of this user from API
    $.get(`https://api.stackexchange.com/2.2/users/${networkUid}/associated?pagesize=100&types=main_site&filter=!myEHrh)iPP&key=${apikey}`)
      .done(function (data) {
        const accounts = data.items.sort((a, b) => {
          return a.creation_date > b.creation_date ? 1 : -1;
        });
        const networkSiteTimestamp = new Date(accounts[0].creation_date * 1000);
        dateNetworkRegContainer.text(dateToIsoString(networkSiteTimestamp));

        const currSite = accounts.filter(v => v.site_url.includes(location.hostname))[0];
        const currSiteTimestamp = new Date(currSite.creation_date * 1000);
        dateSiteRegContainer.text(dateToIsoString(currSiteTimestamp));
      });
  }
}


// Append styles
addStylesheet(`
tr[data-uid] {
  cursor: cell;
}
tr[data-uid].svh-active {
  background: var(--powder-400);
}
tr[data-uid].svh-focus {
  background: var(--powder-400);
}
tr[data-uid].svh-curruser {
  background: var(--green-300);
}

/* All vote tables */
#mainbar-full > .flex__allitems6 > .flex--item > table {
  border: 1px solid var(--_ta-td-bc);
}
#mainbar-full > .flex__allitems6 > .flex--item > table tfoot {
  display: none;
}
#mainbar-full > .flex__allitems6 > .flex--item > table th {
  padding: 10px 4px 10px 8px;
  white-space: nowrap !important;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
#mainbar-full > .flex__allitems6 > .flex--item > table td {
  padding: 2px 8px;
}
#mainbar-full > .flex__allitems6 > .flex--item > table td:last-child:not(.ta-right) {
  padding: 2px 4px;
}
#mainbar-full > .flex__allitems6 > .flex--item > table .user-info {
  margin-right: -5px;
  padding: 5px 0 6px 0px;
}
/* Active vote tables */
#mainbar-full > .flex__allitems6:first-child > .flex--item > table {

}
/* Invalidated vote tables */
#mainbar-full > .flex__allitems6:last-child > .flex--item > table {

}
`); // end stylesheet


// On script run
(function init() {
  doPageLoad();

  // On any page update
  $(document).ajaxComplete(function (_event, _xhr, settings) {

    // If mod popup loaded
    if (settings.url.includes('/admin/contact-cm/template-popup/')) {
      setTimeout(updateModTemplates, 200);
    }
  });
})();