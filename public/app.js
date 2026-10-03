'use strict';

// Guess Market web client. Talks to the existing Guess Market server through exactly the same HTTP API as the
// JavaFX client (same endpoints, parameters and JSON). Data is refreshed by pull every 0.5 seconds.

const API = '/GuessMarket';
const POLL_MS = 500;

const state = {
    user: null,
    timers: [],
    inFlight: {},
    events: [],
    eventsJson: null,
    selectedId: null,
    details: null,
    detailsJson: null,
    detailsTab: 'participants',
    me: null,
    meJson: null,
    ledgerSize: 0,
    usersJson: null,
    selectedHoldingId: null,
    mineOnly: false
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- helpers

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function money(value) {
    return value === null || value === undefined ? '-' : Number(value).toFixed(2);
}

function signedMoney(value) {
    return (value > 0 ? '+' : '') + money(value);
}

function commissionText(percent, type) {
    return percent + '% ' + type;
}

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function call(method, path, params) {
    let url = API + path;
    const options = { method, credentials: 'same-origin', cache: 'no-store' };
    if (params) {
        const form = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            form.append(key, String(value));
        }
        if (method === 'GET') {
            url += '?' + form.toString();
        } else {
            options.body = form;
        }
    }
    let response;
    try {
        response = await fetch(url, options);
    } catch {
        throw new ApiError(0, 'The web client host is not reachable. Is run.bat still running?');
    }
    const text = await response.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        data = null;
    }
    if (!response.ok) {
        let message = data && data.error ? data.error : 'Server error (HTTP ' + response.status + ').';
        if (response.status === 404 && !(data && data.error)) {
            message = 'The Guess Market server was not found at ' + API
                + '. Make sure GuessMarket.war is deployed in Tomcat.';
        }
        throw new ApiError(response.status, message);
    }
    return { data, text };
}

function toast(message, isError) {
    const box = document.createElement('div');
    box.className = 'toast' + (isError ? ' error' : '');
    box.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '\u00d7';
    close.title = 'Close';
    close.onclick = () => box.remove();
    box.appendChild(close);
    $('toasts').appendChild(box);
    setTimeout(() => box.remove(), isError ? 10000 : 6000);
}

// ---------------------------------------------------------------- login / logout

function showLogin(message) {
    stopPolling();
    state.user = null;
    $('main-view').hidden = true;
    $('login-view').hidden = false;
    $('login-error').textContent = message || '';
    $('login-button').disabled = false;
    $('login-name').focus();
}

$('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('login-name').value.trim();
    if (!name) {
        $('login-error').textContent = 'Please enter a user name.';
        return;
    }
    $('login-button').disabled = true;
    $('login-error').textContent = '';
    try {
        await call('POST', '/login', { username: name });
        enterMain(name);
    } catch (error) {
        $('login-error').textContent = error.message;
        $('login-button').disabled = false;
        $('login-name').select();
    }
});

$('logout-button').addEventListener('click', async () => {
    stopPolling();
    try {
        await call('POST', '/logout');
    } catch {
        // the session is dropped on the server side anyway after the online timeout
    }
    showLogin('');
});

function resetData() {
    Object.assign(state, {
        events: [], eventsJson: null, selectedId: null, details: null, detailsJson: null,
        me: null, meJson: null, ledgerSize: 0, usersJson: null, selectedHoldingId: null
    });
    $('events-body').innerHTML = '';
    $('ledger-body').innerHTML = '';
    $('users-body').innerHTML = '';
    $('my-events').innerHTML = '';
    $('involvement').textContent = 'Select one of your events.';
    showDetailsPlaceholder('Select an event to see its details and trade.');
}

function enterMain(name) {
    state.user = name;
    resetData();
    $('top-user').textContent = name;
    $('top-balance').textContent = '';
    $('login-view').hidden = true;
    $('main-view').hidden = false;
    selectTab('events');
    startPolling();
}

// ---------------------------------------------------------------- polling

function startPolling() {
    stopPolling();
    const tasks = { events: refreshEvents, details: refreshDetails, me: refreshMe, users: refreshUsers };
    for (const [name, task] of Object.entries(tasks)) {
        const run = async () => {
            if (state.inFlight[name] || !state.user) {
                return;
            }
            state.inFlight[name] = true;
            try {
                await task();
                $('connection').textContent = '';
            } catch (error) {
                pollFailed(error);
            } finally {
                state.inFlight[name] = false;
            }
        };
        run();
        state.timers.push(setInterval(run, POLL_MS));
    }
}

function stopPolling() {
    state.timers.forEach(clearInterval);
    state.timers = [];
}

function pollFailed(error) {
    if (!state.user) {
        return;
    }
    if (error.status === 401) {
        showLogin('Your session has ended. Please log in again.');
    } else {
        $('connection').textContent = 'Connection problem: ' + error.message + ' Retrying...';
    }
}

// ---------------------------------------------------------------- tabs

function selectTab(name) {
    document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    $('tab-events').hidden = name !== 'events';
    $('tab-account').hidden = name !== 'account';
}

document.querySelectorAll('.tabs .tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));

// ---------------------------------------------------------------- events screen

document.querySelectorAll('.filters .toggle[data-filter]').forEach((button) => button.addEventListener('click', () => {
    button.classList.toggle('on');
    renderEvents();
}));

$('mine-toggle').addEventListener('click', () => {
    state.mineOnly = !state.mineOnly;
    $('mine-toggle').classList.toggle('on', state.mineOnly);
    renderEvents();
});

function filterValues(kind) {
    return [...document.querySelectorAll('.filters .toggle.on[data-filter="' + kind + '"]')].map((b) => b.dataset.value);
}

function passesFilters(event) {
    return filterValues('type').includes(event.type)
        && filterValues('status').includes(event.status)
        && filterValues('commission').includes(event.commissionType)
        && (!state.mineOnly || event.marketMaker === state.user);
}

async function refreshEvents() {
    const { data, text } = await call('GET', '/events');
    if (text === state.eventsJson) {
        return;
    }
    state.eventsJson = text;
    state.events = data;
    renderEvents();
}

function renderEvents() {
    const rows = state.events.filter(passesFilters);
    $('events-body').innerHTML = rows.map((e) => `
        <tr data-id="${e.id}" class="${e.id === state.selectedId ? 'selected' : ''}">
            <td class="num">${e.id}</td>
            <td>${esc(e.name)}</td>
            <td>${esc(e.status)}</td>
            <td>${esc(e.type)}</td>
            <td class="num">${e.optionCount}</td>
            <td>${esc(commissionText(e.commission, e.commissionType))}</td>
            <td class="num">${money(e.account)}</td>
            <td>${esc(e.marketMaker)}</td>
            <td>${esc(e.winner || '')}</td>
        </tr>`).join('');
    $('events-empty').hidden = rows.length > 0;
    $('events-empty').textContent = state.events.length === 0
        ? 'No events yet. Events are loaded by the JavaFX clients.'
        : 'No event matches the selected filters.';
    $('events-count').textContent = 'Showing ' + rows.length + ' of ' + state.events.length;
    if (state.selectedId !== null && !rows.some((e) => e.id === state.selectedId)) {
        state.selectedId = null;
        state.details = null;
        state.detailsJson = null;
        showDetailsPlaceholder('Select an event to see its details and trade.');
    }
    updateActions();
}

$('events-body').addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-id]');
    if (!row) {
        return;
    }
    const id = Number(row.dataset.id);
    if (id === state.selectedId) {
        return;
    }
    state.selectedId = id;
    state.details = null;
    state.detailsJson = null;
    document.querySelectorAll('#events-body tr').forEach((tr) => tr.classList.toggle('selected', tr === row));
    showDetailsPlaceholder('Loading...');
    refreshDetails().catch(pollFailed);
});

function selectedSummary() {
    return state.events.find((e) => e.id === state.selectedId) || null;
}

async function refreshDetails() {
    const id = state.selectedId;
    if (id === null) {
        return;
    }
    const { data, text } = await call('GET', '/event', { id });
    if (id !== state.selectedId || text === state.detailsJson) {
        return;
    }
    state.detailsJson = text;
    state.details = data;
    renderDetails();
}

function showDetailsPlaceholder(text) {
    $('details').innerHTML = '<p class="placeholder">' + esc(text) + '</p>';
}

function renderDetails() {
    const e = state.details;
    const container = $('details');
    const scrollTop = container.scrollTop;
    const scrolls = [...container.querySelectorAll('.book-wrap, .sub-page')].map((el) => el.scrollTop);

    const info = [
        ['Status', e.status + (e.winner ? ' - winner: ' + e.winner : '')],
        ['Method', e.type],
        ['Commission', commissionText(e.commission, e.commissionType)],
        ['Market maker', e.marketMaker],
        e.type === 'LMSR'
            ? ['LMSR b', money(e.b)]
            : ['Order book', 'd = ' + e.d + ', initial = ' + e.initial + ', allow-mint = ' + e.allowMint],
        ['Opening cost', money(e.openingCost)],
        ['Event account', money(e.account)],
        ['Collected commission', money(e.collectedCommission)]
    ];
    const infoHtml = info.map(([k, v]) => `<dt>${esc(k)}:</dt><dd>${esc(v)}</dd>`).join('');

    const optionsHtml = e.options.map((o) => {
        const won = e.winner === o.name;
        const title = `<div class="option-title">${o.number}) ${esc(o.name)}${won ? ' - WINNER' : ''}</div>`;
        if (!o.book) {
            const percent = Math.max(0, Math.min(100, o.price * 100));
            return `<div class="option-box${won ? ' winner' : ''}">${title}
                <div class="price-bar"><div style="width:${percent.toFixed(1)}%"></div></div>
                <div class="option-stats">Price: ${money(o.price)} &nbsp;|&nbsp; Shares in market: ${o.outstandingShares}</div>
            </div>`;
        }
        const b = o.book;
        const orders = [...b.asks].reverse().concat(b.bids);
        const rows = orders.length === 0
            ? '<tr><td colspan="4" class="hint">No waiting orders.</td></tr>'
            : orders.map((r) => `<tr class="${r.side === 'BUY' ? 'credit' : 'debit'}">
                <td>${esc(r.side)}</td><td class="num">${money(r.price)}</td>
                <td class="num">${r.quantity}</td><td>${esc(r.user)}</td></tr>`).join('');
        return `<div class="option-box${won ? ' winner' : ''}">${title}
            <div class="option-stats">Last ${money(b.last)} &nbsp; Bid ${money(b.bestBid)} &nbsp; Ask ${money(b.bestAsk)}
                &nbsp; Mid ${money(b.mid)} &nbsp; Spread ${money(b.spread)}<br>Shares in market: ${o.outstandingShares}</div>
            <div class="book-wrap"><table class="grid">
                <thead><tr><th>Side</th><th>Price</th><th>Qty</th><th>User</th></tr></thead>
                <tbody>${rows}</tbody></table></div>
        </div>`;
    }).join('');

    const participantHead = '<th>User</th>' + e.options.map((o) =>
        `<th>${esc(o.name)} shares</th><th>${esc(o.name)} paid</th>`).join('');
    const participantRows = e.participants.length === 0
        ? `<tr><td colspan="${1 + 2 * e.options.length}" class="hint">No participants yet.</td></tr>`
        : e.participants.map((p) => '<tr><td>' + esc(p.user) + '</td>' + e.options.map((o, i) =>
            `<td class="num">${p.shares[i] ?? 0}</td><td class="num">${money(p.paid[i] ?? 0)}</td>`).join('') + '</tr>').join('');

    const historyRows = e.history.length === 0
        ? '<tr><td colspan="9" class="hint">No trades yet.</td></tr>'
        : e.history.map((t) => `<tr><td>${esc(t.time)}</td><td>${esc(t.kind)}</td><td>${esc(t.user)}</td>
            <td>${esc(t.counterparty)}</td><td>${esc(t.option)}</td><td class="num">${t.quantity}</td>
            <td class="num">${money(t.price)}</td><td class="num">${money(t.commission)}</td>
            <td class="num">${money(t.total)}</td></tr>`).join('');

    const tab = state.detailsTab;
    container.innerHTML = `
        <p class="event-name">${esc(e.name)} (id ${e.id})</p>
        <p class="event-description">${esc(e.description)}</p>
        <dl class="info-grid">${infoHtml}</dl>
        <div class="actions">
            <button type="button" class="primary" data-action="trade">Participate / Trade</button>
            <button type="button" data-action="open">Open event</button>
            <button type="button" data-action="close">Close event</button>
        </div>
        <h3>Options</h3>
        <div class="options-grid">${optionsHtml}</div>
        <div class="sub-tabs">
            <button type="button" class="tab${tab === 'participants' ? ' active' : ''}" data-subtab="participants">Participations information</button>
            <button type="button" class="tab${tab === 'history' ? ' active' : ''}" data-subtab="history">Trade history</button>
        </div>
        <div class="sub-page" data-page="participants"${tab === 'participants' ? '' : ' hidden'}>
            <table class="grid"><thead><tr>${participantHead}</tr></thead><tbody>${participantRows}</tbody></table>
        </div>
        <div class="sub-page" data-page="history"${tab === 'history' ? '' : ' hidden'}>
            <table class="grid"><thead><tr><th>Time</th><th>Kind</th><th>Buyer</th><th>Seller / MM</th><th>Option</th>
                <th>Qty</th><th>Price</th><th>Commission</th><th>Total</th></tr></thead><tbody>${historyRows}</tbody></table>
        </div>`;

    container.scrollTop = scrollTop;
    container.querySelectorAll('.book-wrap, .sub-page').forEach((el, i) => {
        if (scrolls[i] !== undefined) {
            el.scrollTop = scrolls[i];
        }
    });
    updateActions();
}

function updateActions() {
    const summary = selectedSummary();
    const isMm = summary !== null && summary.marketMaker === state.user;
    const blocked = state.me ? state.me.blocked : false;
    const set = (action, enabled) => {
        const button = document.querySelector('#details [data-action="' + action + '"]');
        if (button) {
            button.disabled = !enabled;
        }
    };
    set('open', isMm && summary.status === 'Not started');
    set('close', isMm && summary.status === 'Active');
    set('trade', summary !== null && summary.status === 'Active' && !blocked);
}

$('details').addEventListener('click', (event) => {
    const sub = event.target.closest('[data-subtab]');
    if (sub) {
        state.detailsTab = sub.dataset.subtab;
        $('details').querySelectorAll('[data-subtab]').forEach((b) => b.classList.toggle('active', b === sub));
        $('details').querySelectorAll('[data-page]').forEach((p) => { p.hidden = p.dataset.page !== state.detailsTab; });
        return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled || !state.details) {
        return;
    }
    const action = button.dataset.action;
    if (action === 'open') {
        runAction('/event/open', { id: state.details.id });
    } else if (action === 'close') {
        closeDialog(state.details);
    } else if (state.details.type === 'LMSR') {
        lmsrDialog(state.details);
    } else {
        orderDialog(state.details);
    }
});

async function runAction(path, params) {
    try {
        const { data } = await call('POST', path, params);
        toast(data && data.message ? data.message : 'Done.', false);
        refreshNow();
        return true;
    } catch (error) {
        if (error.status === 401) {
            showLogin('Your session has ended. Please log in again.');
        } else {
            toast(error.message, true);
        }
        return false;
    }
}

function refreshNow() {
    refreshEvents().catch(pollFailed);
    refreshDetails().catch(pollFailed);
    refreshMe().catch(pollFailed);
    refreshUsers().catch(pollFailed);
}

// ---------------------------------------------------------------- dialogs

function openModal(html, onSubmit) {
    const modal = $('modal');
    modal.innerHTML = html;
    $('modal-backdrop').hidden = false;
    const first = modal.querySelector('select, input');
    if (first) {
        first.focus();
    }
    modal.onsubmit = async (event) => {
        event.preventDefault();
        const errorBox = modal.querySelector('.error');
        errorBox.textContent = '';
        const submit = modal.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            const result = await onSubmit(modal);
            if (result !== false) {
                closeModal();
            }
        } catch (error) {
            errorBox.textContent = error.message;
        } finally {
            submit.disabled = false;
        }
    };
    modal.querySelector('[data-cancel]').onclick = closeModal;
}

function closeModal() {
    $('modal-backdrop').hidden = true;
    $('modal').innerHTML = '';
    $('modal').onsubmit = null;
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('modal-backdrop').hidden) {
        closeModal();
    }
});

async function submitAction(path, params) {
    const { data } = await call('POST', path, params);
    toast(data && data.message ? data.message : 'Done.', false);
    refreshNow();
}

function optionSelect(event, name) {
    return `<select name="${name}">` + event.options.map((o) =>
        `<option value="${o.number}">${o.number}) ${esc(o.name)}</option>`).join('') + '</select>';
}

function wholeNumber(value, what) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(what + ' must be a positive whole number.');
    }
    return n;
}

function lmsrCost(b, quantities) {
    const max = Math.max(...quantities.map((q) => q / b));
    return b * (max + Math.log(quantities.reduce((sum, q) => sum + Math.exp(q / b - max), 0)));
}

function lmsrDialog(event) {
    openModal(`
        <h2>Buy shares - ${esc(event.name)}</h2>
        <p class="hint">LMSR: you buy from the event account. Prices change with every purchase.</p>
        <div class="field"><label>Option</label>${optionSelect(event, 'option')}</div>
        <div class="field"><label>Number of shares</label><input name="quantity" type="number" min="1" step="1" value="10" required></div>
        <p class="market-info" data-info></p>
        <p class="error"></p>
        <div class="buttons"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Buy</button></div>`,
        async (form) => {
            const quantity = wholeNumber(form.quantity.value, 'Number of shares');
            await submitAction('/event/buy', { id: event.id, option: form.option.value, quantity });
        });
    const form = $('modal');
    const update = () => {
        const index = Number(form.option.value) - 1;
        const option = event.options[index];
        const quantity = Number(form.quantity.value);
        let text = 'Current price of ' + option.name + ': ' + money(option.price);
        if (Number.isInteger(quantity) && quantity > 0) {
            const before = event.options.map((o) => o.outstandingShares);
            const after = before.slice();
            after[index] += quantity;
            const cost = lmsrCost(event.b, after) - lmsrCost(event.b, before);
            const commission = event.commissionType === 'on-purchase' ? cost * event.commission / 100 : 0;
            text += '\nEstimated cost: ' + money(cost)
                + (commission > 0 ? '\nEstimated commission: ' + money(commission) + '\nEstimated total: ' + money(cost + commission) : '');
        }
        form.querySelector('[data-info]').textContent = text;
    };
    form.option.addEventListener('change', update);
    form.quantity.addEventListener('input', update);
    update();
}

function orderDialog(event) {
    const maxPrice = event.d || 1;
    openModal(`
        <h2>Place an order - ${esc(event.name)}</h2>
        <p class="hint">Order book: your order is matched against waiting orders, or waits in the book.</p>
        <div class="field"><label>Option</label>${optionSelect(event, 'option')}</div>
        <div class="field"><label>Side</label><select name="side"><option value="BUY">BUY</option><option value="SELL">SELL</option></select></div>
        <div class="field"><label>Number of shares</label><input name="quantity" type="number" min="1" step="1" value="10" required></div>
        <div class="field"><label>Price per share (0.01 - ${money(maxPrice)})</label><input name="price" type="number" min="0.01" max="${maxPrice}" step="0.01" required></div>
        <p class="market-info" data-info></p>
        <p class="error"></p>
        <div class="buttons"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Place order</button></div>`,
        async (form) => {
            const quantity = wholeNumber(form.quantity.value, 'Number of shares');
            const price = Number(form.price.value);
            if (!(price > 0)) {
                throw new Error('Price must be a positive number.');
            }
            await submitAction('/event/order', { id: event.id, option: form.option.value, side: form.side.value, quantity, price });
        });
    const form = $('modal');
    const update = () => {
        const index = Number(form.option.value) - 1;
        const option = event.options[index];
        const b = option.book;
        const holding = state.me ? state.me.events.find((h) => h.eventId === event.id) : null;
        const held = holding ? (holding.shares[index] ?? 0) : 0;
        form.querySelector('[data-info]').textContent = option.name + ':  Last ' + money(b.last) + '   Bid ' + money(b.bestBid)
            + '   Ask ' + money(b.bestAsk) + '\nYou hold ' + held + ' shares of this option.'
            + (event.commissionType === 'on-purchase' ? '\nBuyers pay ' + event.commission + '% commission.' : '');
        if (!form.price.value) {
            const suggestion = form.side.value === 'BUY' ? b.bestAsk : b.bestBid;
            if (suggestion !== null && suggestion !== undefined) {
                form.price.value = Number(suggestion).toFixed(2);
            }
        }
    };
    form.option.addEventListener('change', update);
    form.side.addEventListener('change', update);
    update();
}

function closeDialog(event) {
    openModal(`
        <h2>Close event - ${esc(event.name)}</h2>
        <p class="hint">Choose the option that actually happened. Holders of the winning option are paid and the event ends.</p>
        <div class="field"><label>Winning option</label>${optionSelect(event, 'winner')}</div>
        <p class="error"></p>
        <div class="buttons"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Close event</button></div>`,
        async (form) => {
            await submitAction('/event/close', { id: event.id, winner: form.winner.value });
        });
}

// ---------------------------------------------------------------- account screen

async function refreshMe() {
    const from = state.ledgerSize;
    const { data: me } = await call('GET', '/me', { ledgerFrom: from });
    if (from !== state.ledgerSize) {
        return;
    }
    if (me.ledger.length > 0) {
        appendLedger(me.ledger);
    }
    state.ledgerSize = me.ledgerSize;
    const withoutLedger = JSON.stringify({ ...me, ledger: [] });
    if (withoutLedger === state.meJson) {
        return;
    }
    state.meJson = withoutLedger;
    state.me = me;
    renderMe();
}

function appendLedger(lines) {
    const wrap = $('ledger-wrap');
    const atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 5;
    $('ledger-body').insertAdjacentHTML('beforeend', lines.map((l) => `
        <tr class="${l.amount >= 0 ? 'credit' : 'debit'}">
            <td class="num">${l.number}</td><td>${esc(l.time)}</td>
            <td class="num">${signedMoney(l.amount)}</td><td class="num">${money(l.balanceAfter)}</td>
            <td>${esc(l.description)}</td>
        </tr>`).join(''));
    $('ledger-empty').hidden = true;
    if (atBottom) {
        wrap.scrollTop = wrap.scrollHeight;
    }
}

function renderMe() {
    const me = state.me;
    state.user = me.name;
    $('top-user').textContent = me.name;
    $('top-balance').textContent = 'Balance: ' + money(me.balance);
    $('top-blocked').hidden = !me.blocked;
    $('acc-name').textContent = me.name;
    $('acc-balance').textContent = 'Balance: ' + money(me.balance);
    const mm = me.marketMakerOf.length === 0 ? 'not a market maker' : 'market maker of ' + me.marketMakerOf.length + ' event(s)';
    $('acc-state').textContent = (me.blocked ? 'BLOCKED | ' : '') + mm;
    $('acc-notice').hidden = !me.notice;
    $('acc-notice').textContent = me.notice || '';
    $('ledger-empty').hidden = state.ledgerSize > 0;

    if (!me.events.some((h) => h.eventId === state.selectedHoldingId)) {
        state.selectedHoldingId = null;
    }
    $('my-events').innerHTML = me.events.length === 0
        ? '<li class="empty">You are not involved in any event yet.</li>'
        : me.events.map((h) => `<li data-id="${h.eventId}" class="${h.eventId === state.selectedHoldingId ? 'selected' : ''}">
            ${esc(h.eventName)}${h.marketMaker ? ' [MM]' : ''} - ${esc(h.status)}</li>`).join('');
    renderInvolvement();
    updateActions();
}

$('my-events').addEventListener('click', (event) => {
    const item = event.target.closest('li[data-id]');
    if (!item) {
        return;
    }
    state.selectedHoldingId = Number(item.dataset.id);
    document.querySelectorAll('#my-events li').forEach((li) => li.classList.toggle('selected', li === item));
    renderInvolvement();
});

function renderInvolvement() {
    const box = $('involvement');
    const holding = state.me && state.me.events.find((h) => h.eventId === state.selectedHoldingId);
    if (!holding) {
        box.textContent = 'Select one of your events.';
        return;
    }
    const lines = [
        'Event: ' + holding.eventName + ' (id ' + holding.eventId + ')',
        'Status: ' + holding.status + ' | Type: ' + holding.type,
        'My role: ' + (holding.marketMaker ? 'Market maker' : 'Participant'),
        '',
        'My shares:'
    ];
    holding.optionNames.forEach((name, i) => {
        lines.push('  ' + (i + 1) + ') ' + name + ' | shares: ' + holding.shares[i] + ' | paid: ' + money(holding.paid[i]));
    });
    lines.push('Commission paid: ' + money(holding.commissionPaid));
    if (holding.winner) {
        lines.push('Winner: ' + holding.winner);
    }
    if (holding.profit !== null && holding.profit !== undefined) {
        lines.push('Trading profit/loss after close: ' + signedMoney(holding.profit));
    }
    lines.push('', 'My trades (newest first):');
    if (holding.trades.length === 0) {
        lines.push('  No personal trades yet.');
    }
    holding.trades.forEach((t) => lines.push('  ' + t.time + ' | ' + t.side + ' | ' + t.option + ' | shares: ' + t.quantity
        + ' | price: ' + money(t.price) + ' | commission: ' + money(t.commission) + ' | with: ' + t.counterparty));
    const scrollTop = box.scrollTop;
    box.textContent = lines.join('\n');
    box.scrollTop = scrollTop;
}

async function refreshUsers() {
    const { data, text } = await call('GET', '/users');
    if (text === state.usersJson) {
        return;
    }
    state.usersJson = text;
    const others = data.filter((u) => u.name !== state.user);
    $('users-body').innerHTML = others.map((u) => `
        <tr><td>${esc(u.name)}</td>
            <td class="num">${money(u.balance)}${u.blocked ? ' (blocked)' : ''}</td>
            <td>${u.marketMaker ? 'Yes' : 'No'}</td>
            <td>${u.online ? 'Yes' : 'No'}</td></tr>`).join('');
    $('users-empty').hidden = others.length > 0;
}

$('deposit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number($('deposit-amount').value);
    if (!(amount > 0)) {
        toast('Please enter a positive amount to deposit.', true);
        return;
    }
    if (await runAction('/deposit', { amount })) {
        $('deposit-amount').value = '';
    }
});

// ---------------------------------------------------------------- start

(async function start() {
    try {
        const { data: me } = await call('GET', '/me', { ledgerFrom: 0 });
        enterMain(me.name);
    } catch (error) {
        showLogin(error.status === 401 ? '' : error.message);
    }
})();
