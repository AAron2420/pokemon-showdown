/**
 * Pokemon Showdown log viewer
 *
 * by Zarel
 * @license MIT
 */

import {FS} from "../../lib/fs";
import * as child_process from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as Dashycode from '../../lib/dashycode';

const execFile = util.promisify(child_process.execFile);
const DAY = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 3000;

class LogReaderRoom {
	roomid: RoomID;
	constructor(roomid: RoomID) {
		this.roomid = roomid;
	}

	async listMonths() {
		try {
			const listing = await FS(`logs/chat/${this.roomid}`).readdir();
			return listing.filter(file => /^[0-9][0-9][0-9][0-9]-[0-9][0-9]$/.test(file));
		} catch (err) {
			return [];
		}
	}

	async listDays(month: string) {
		try {
			const listing = await FS(`logs/chat/${this.roomid}/${month}`).readdir();
			return listing.filter(file => /\.txt$/.test(file)).map(file => file.slice(0, -4));
		} catch (err) {
			return [];
		}
	}

	async getLog(day: string) {
		const month = LogReader.getMonth(day);
		const log = FS(`logs/chat/${this.roomid}/${month}/${day}.txt`);
		if (!await log.exists()) return null;
		return log.createReadStream();
	}
}

const LogReader = new class {
	async get(roomid: RoomID) {
		if (!await FS(`logs/chat/${roomid}`).exists()) return null;
		return new LogReaderRoom(roomid);
	}

	async list() {
		const listing = await FS(`logs/chat`).readdir();
		return listing.filter(file => /^[a-z0-9-]+$/.test(file)) as RoomID[];
	}

	async listCategorized(user: User, opts?: string) {
		const list = await this.list();
		const isUpperStaff = user.can('rangeban');
		const isStaff = user.can('lock');

		const official = [];
		const normal = [];
		const hidden = [];
		const secret = [];
		const deleted = [];
		const personal: RoomID[] = [];
		const deletedPersonal: RoomID[] = [];
		let atLeastOne = false;

		for (const roomid of list) {
			const room = Rooms.get(roomid);
			const forceShow = room && (
				// you are authed in the room
				(room.auth && user.id in room.auth && user.can('mute', null, room)) ||
				// you are staff and currently in the room
				(isStaff && user.inRooms.has(room.roomid))
			);
			if (!isUpperStaff && !forceShow) {
				if (!isStaff) continue;
				if (!room) continue;
				if (!room.checkModjoin(user)) continue;
				if (room.isPrivate === true) continue;
			}

			atLeastOne = true;
			if (roomid.includes('-')) {
				const matchesOpts = opts && roomid.startsWith(`${opts}-`);
				if (matchesOpts || opts === 'all' || forceShow) {
					(room ? personal : deletedPersonal).push(roomid);
				}
			} else if (!room) {
				if (opts === 'all' || opts === 'deleted') deleted.push(roomid);
			} else if (room.isOfficial) {
				official.push(roomid);
			} else if (!room.isPrivate) {
				normal.push(roomid);
			} else if (room.isPrivate === 'hidden') {
				hidden.push(roomid);
			} else {
				secret.push(roomid);
			}
		}

		if (!atLeastOne) return null;
		return {official, normal, hidden, secret, deleted, personal, deletedPersonal};
	}

	async read(roomid: RoomID, day: string, limit: number) {
		const roomLog = await LogReader.get(roomid);
		const stream = await roomLog!.getLog(day);
		let buf = '';
		let i = LogViewer.results || 0;
		if (!stream) {
			buf += `<p class="message-error">Room "${roomid}" doesn't have logs for ${day}</p>`;
		} else {
			let line;
			while ((line = await stream.readLine()) !== null && i < limit) {
				const rendered = LogViewer.renderLine(line);
				if (rendered) {
					buf += `${line}\n`;
					i++;
				}
			}
		}
		return buf;
	}

	getMonth(day: string) {
		return day.slice(0, 7);
	}
	nextDay(day: string) {
		const nextDay = new Date(new Date(day).getTime() + DAY);
		return nextDay.toISOString().slice(0, 10);
	}
	prevDay(day: string) {
		const prevDay = new Date(new Date(day).getTime() - DAY);
		return prevDay.toISOString().slice(0, 10);
	}
	nextMonth(month: string) {
		const nextMonth = new Date(new Date(`${month}-15`).getTime() + 30 * DAY);
		return nextMonth.toISOString().slice(0, 7);
	}
	prevMonth(month: string) {
		const prevMonth = new Date(new Date(`${month}-15`).getTime() - 30 * DAY);
		return prevMonth.toISOString().slice(0, 7);
	}

	today() {
		return Chat.toTimestamp(new Date()).slice(0, 10);
	}
};

export const LogViewer = new class {
	results: number;
	constructor() {
		this.results = 0;
	}
	async day(roomid: RoomID, day: string, opts?: string) {
		const month = LogReader.getMonth(day);
		let buf = `<div class="pad"><p>` +
			`<a roomid="view-chatlog">◂ All logs</a> / ` +
			`<a roomid="view-chatlog-${roomid}">${roomid}</a> /  ` +
			`<a roomid="view-chatlog-${roomid}--${month}">${month}</a> / ` +
			`<strong>${day}</strong></p><hr />`;

		const roomLog = await LogReader.get(roomid);
		if (!roomLog) {
			buf += `<p class="message-error">Room "${roomid}" doesn't exist</p></div>`;
			return this.linkify(buf);
		}

		const prevDay = LogReader.prevDay(day);
		buf += `<p><a roomid="view-chatlog-${roomid}--${prevDay}" class="blocklink" style="text-align:center">▲<br />${prevDay}</a></p>` +
			`<div class="message-log" style="overflow-wrap: break-word">`;

		const stream = await roomLog.getLog(day);
		if (!stream) {
			buf += `<p class="message-error">Room "${roomid}" doesn't have logs for ${day}</p>`;
		} else {
			let line;
			while ((line = await stream.readLine()) !== null) {
				buf += this.renderLine(line, opts);
			}
		}
		buf += `</div>`;
		if (day !== LogReader.today()) {
			const nextDay = LogReader.nextDay(day);
			buf += `<p><a roomid="view-chatlog-${roomid}--${nextDay}" class="blocklink" style="text-align:center">${nextDay}<br />▼</a></p>`;
		}

		buf += `</div>`;
		return this.linkify(buf);
	}

	renderDayResults(results: {[day: string]: SearchMatch[]}, roomid: RoomID) {
		const renderResult = (match: SearchMatch) => {
			this.results++;
			return (
				this.renderLine(match[0]) +
				this.renderLine(match[1]) +
				`<div class="chat chatmessage highlighted">${this.renderLine(match[2])}</div>` +
				this.renderLine(match[3]) +
				this.renderLine(match[4])
			);
		};

		let buf = ``;
		for (const day in results) {
			const dayResults = results[day];
			const plural = dayResults.length !== 1 ? "es" : "";
			buf += `<details><summary>${dayResults.length} match${plural} on `;
			buf += `<a href="view-chatlog-${roomid}--${day}">${day}</a></summary><br /><hr />`;
			buf += `<p>${dayResults.filter(Boolean).map(result => renderResult(result)).join(`<hr />`)}</p>`;
			buf += `</details><hr />`;
		}
		return buf;
	}

	async searchMonth(roomid: RoomID, month: string, search: string, limit: number, year = false) {
		const {results, total} = await LogSearcher.fsSearchMonth(roomid, month, search, limit);
		if (!total) {
			return LogViewer.error(`No matches found for ${search} on ${roomid}.`);
		}

		let buf = (
			`<br><div class="pad"><strong>Searching for "${search}" in ${roomid} (${month}):</strong><hr>`
		);
		buf += this.renderDayResults(results, roomid);
		if (total > limit) {
			// cap is met & is not being used in a year read
			buf += `<br><strong>Max results reached, capped at ${total > limit ? limit : MAX_RESULTS}</strong>`;
			buf += `<br><div style="text-align:center">`;
			if (total < MAX_RESULTS) {
				buf += `<button class="button" name="send" value="/sl ${search}|${roomid}|${month}|${limit + 100}">View 100 more<br />&#x25bc;</button>`;
				buf += `<button class="button" name="send" value="/sl ${search}|${roomid}|${month}|all">View all<br />&#x25bc;</button></div>`;
			}
		}
		buf += `</div>`;
		this.results = 0;
		return buf;
	}

	async searchYear(roomid: RoomID, year: string | null, search: string, limit: number) {
		const {results, total} = await LogSearcher.fsSearchYear(roomid, year, search, limit);
		if (!total) {
			return LogViewer.error(`No matches found for ${search} on ${roomid}.`);
		}
		let buf = '';
		if (year) {
			buf += `<div class="pad"><strong><br>Searching year: ${year}: </strong><hr>`;
		}	else {
			buf += `<div class="pad"><strong><br>Searching all logs: </strong><hr>`;
		}
		buf += this.renderDayResults(results, roomid);
		if (total > limit) {
			// cap is met
			buf += `<br><strong>Max results reached, capped at ${total > limit ? limit : MAX_RESULTS}</strong>`;
			buf += `<br><div style="text-align:center">`;
			if (total < MAX_RESULTS) {
				buf += `<button class="button" name="send" value="/sl ${search}|${roomid}|${year}|${limit + 100}">View 100 more<br />&#x25bc;</button>`;
				buf += `<button class="button" name="send" value="/sl ${search}|${roomid}|${year}|all">View all<br />&#x25bc;</button></div>`;
			}
		}
		this.results = 0;
		return buf;
	}

	renderLine(fullLine: string, opts?: string) {
		if (!fullLine) return ``;
		let timestamp = fullLine.slice(0, opts ? 8 : 5);
		let line;
		if (/^[0-9:]+$/.test(timestamp)) {
			line = fullLine.charAt(9) === '|' ? fullLine.slice(10) : '|' + fullLine.slice(9);
		} else {
			timestamp = '';
			line = '!NT|';
		}
		if (opts !== 'all' && (
			line.startsWith(`userstats|`) ||
			line.startsWith('J|') || line.startsWith('L|') || line.startsWith('N|')
		)) return ``;

		const cmd = line.slice(0, line.indexOf('|'));
		switch (cmd) {
		case 'c': {
			const [, name, message] = Chat.splitFirst(line, '|', 2);
			if (name.length <= 1) {
				return `<div class="chat"><small>[${timestamp}] </small><q>${Chat.formatText(message)}</q></div>`;
			}
			if (message.startsWith(`/log `)) {
				return `<div class="chat"><small>[${timestamp}] </small><q>${Chat.formatText(message.slice(5))}</q></div>`;
			}
			if (message.startsWith(`/raw `)) {
				return `<div class="notice">${message.slice(5)}</div>`;
			}
			if (message.startsWith(`/uhtml `) || message.startsWith(`/uhtmlchange `)) {
				if (message.startsWith(`/uhtmlchange `)) return ``;
				if (opts !== 'all') return `<div class="notice">[uhtml box hidden]</div>`;
				return `<div class="notice">${message.slice(message.indexOf(',') + 1)}</div>`;
			}
			const group = name.charAt(0) !== ' ' ? `<small>${name.charAt(0)}</small>` : ``;
			return `<div class="chat"><small>[${timestamp}] </small><strong>${group}${name.slice(1)}:</strong> <q>${Chat.formatText(message)}</q></div>`;
		}
		case 'html': case 'raw': {
			const [, html] = Chat.splitFirst(line, '|', 1);
			return `<div class="notice">${html}</div>`;
		}
		case 'uhtml': case 'uhtmlchange': {
			if (cmd !== 'uhtml') return ``;
			const [, , html] = Chat.splitFirst(line, '|', 2);
			return `<div class="notice">${html}</div>`;
		}
		case '!NT':
			return `<div class="chat">${Chat.escapeHTML(fullLine)}</div>`;
		case '':
			return `<div class="chat"><small>[${timestamp}] </small>${Chat.escapeHTML(line.slice(1))}</div>`;
		default:
			return `<div class="chat"><small>[${timestamp}] </small><code>${'|' + Chat.escapeHTML(line)}</code></div>`;
		}
	}

	async month(roomid: RoomID, month: string) {
		let buf = `<div class="pad"><p>` +
			`<a roomid="view-chatlog">◂ All logs</a> / ` +
			`<a roomid="view-chatlog-${roomid}">${roomid}</a> / ` +
			`<strong>${month}</strong></p><hr />`;

		const roomLog = await LogReader.get(roomid);
		if (!roomLog) {
			buf += `<p class="message-error">Room "${roomid}" doesn't exist</p></div>`;
			return this.linkify(buf);
		}

		const prevMonth = LogReader.prevMonth(month);
		buf += `<p><a roomid="view-chatlog-${roomid}--${prevMonth}" class="blocklink" style="text-align:center">▲<br />${prevMonth}</a></p><div>`;

		const days = await roomLog.listDays(month);
		if (!days.length) {
			buf += `<p class="message-error">Room "${roomid}" doesn't have logs in ${month}</p></div>`;
			return this.linkify(buf);
		} else {
			for (const day of days) {
				buf += `<p>- <a roomid="view-chatlog-${roomid}--${day}">${day}</a></p>`;
			}
		}

		if (!LogReader.today().startsWith(month)) {
			const nextMonth = LogReader.nextMonth(month);
			buf += `<p><a roomid="view-chatlog-${roomid}--${nextMonth}" class="blocklink" style="text-align:center">${nextMonth}<br />▼</a></p>`;
		}

		buf += `</div>`;
		return this.linkify(buf);
	}
	async room(roomid: RoomID) {
		let buf = `<div class="pad"><p>` +
			`<a roomid="view-chatlog">◂ All logs</a> / ` +
			`<strong>${roomid}</strong></p><hr />`;

		const roomLog = await LogReader.get(roomid);
		if (!roomLog) {
			buf += `<p class="message-error">Room "${roomid}" doesn't exist</p></div>`;
			return this.linkify(buf);
		}

		const months = await roomLog.listMonths();
		if (!months.length) {
			buf += `<p class="message-error">Room "${roomid}" doesn't have logs</p></div>`;
			return this.linkify(buf);
		}

		for (const month of months) {
			buf += `<p>- <a roomid="view-chatlog-${roomid}--${month}">${month}</a></p>`;
		}
		buf += `</div>`;
		return this.linkify(buf);
	}
	async list(user: User, opts?: string) {
		let buf = `<div class="pad"><p>` +
			`<strong>All logs</strong></p><hr />`;

		const categories: {[k: string]: string} = {
			'official': "Official",
			'normal': "Public",
			'hidden': "Hidden",
			'secret': "Secret",
			'deleted': "Deleted",
			'personal': "Personal",
			'deletedPersonal': "Deleted Personal",
		};
		const list = await LogReader.listCategorized(user, opts) as {[k: string]: RoomID[]};

		if (!list) {
			buf += `<p class="message-error">You must be a staff member of a room, to view logs</p></div>`;
			return buf;
		}

		const showPersonalLink = opts !== 'all' && user.can('rangeban');
		for (const k in categories) {
			if (!list[k].length && !(['personal', 'deleted'].includes(k) && showPersonalLink)) {
				continue;
			}
			buf += `<p>${categories[k]}</p>`;
			if (k === 'personal' && showPersonalLink) {
				if (opts !== 'help') buf += `<p>- <a roomid="view-chatlog--help">(show all help)</a></p>`;
				if (opts !== 'groupchat') buf += `<p>- <a roomid="view-chatlog--groupchat">(show all groupchat)</a></p>`;
			}
			if (k === 'deleted' && showPersonalLink) {
				if (opts !== 'deleted') buf += `<p>- <a roomid="view-chatlog--deleted">(show deleted)</a></p>`;
			}
			for (const roomid of list[k]) {
				buf += `<p>- <a roomid="view-chatlog-${roomid}">${roomid}</a></p>`;
			}
		}
		buf += `</div>`;
		return this.linkify(buf);
	}
	error(message: string) {
		return `<div class="pad"><p class="message-error">${message}</p></div>`;
	}
	linkify(buf: string) {
		return buf.replace(/<a roomid="/g, `<a target="replace" href="/`);
	}
};

/** match with two lines of context in either direction */
type SearchMatch = readonly [string, string, string, string, string];

const LogSearcher = new class {
	fsSearch(roomid: RoomID, search: string, date: string, limit: number | null) {
		const isAll = (date === 'all');
		const isYear = (date.length === 4);
		const isMonth = (date.length === 7);
		if (!limit || limit > MAX_RESULTS) limit = MAX_RESULTS;
		if (isAll) {
			return LogViewer.searchYear(roomid, null, search, limit);
		} else if (isYear) {
			date = date.substr(0, 4);
			return LogViewer.searchYear(roomid, date, search, limit);
		} else if (isMonth) {
			date = date.substr(0, 7);
			return LogViewer.searchMonth(roomid, date, search, limit);
		} else {
			return LogViewer.error("Invalid date.");
		}
	}

	async fsSearchDay(roomid: RoomID, day: string, search: string, limit?: number | null) {
		if (!limit || limit > MAX_RESULTS) limit = MAX_RESULTS;
		const text = await LogReader.read(roomid, day, limit);
		if (!text) return [];
		const lines = text.split('\n');
		const matches: SearchMatch[] = [];

		const searchTerms = search.split('-');
		const searchTermRegexes = searchTerms.map(term => new RegExp(term, 'i'));
		function matchLine(line: string) {
			return searchTermRegexes.every(term => term.test(line));
		}

		for (const [i, line] of lines.entries()) {
			if (matchLine(line)) {
				matches.push([
					lines[i - 2],
					lines[i - 1],
					line,
					lines[i + 1],
					lines[i + 2],
				]);
				if (matches.length > limit) break;
			}
		}
		return matches;
	}

	async fsSearchMonth(roomid: RoomID, month: string, search: string, limit: number) {
		if (!limit || limit > MAX_RESULTS) limit = MAX_RESULTS;
		const log = await LogReader.get(roomid);
		if (!log) return {results: {}, total: 0};
		const days = await log.listDays(month);
		const results: {[k: string]: SearchMatch[]} = {};
		let total = 0;

		for (const day of days) {
			const dayResults = await this.fsSearchDay(roomid, day, search, limit ? limit - total : null);
			if (!dayResults.length) continue;
			total += dayResults.length;
			results[day] = dayResults;
			if (total > limit) break;
		}
		return {results, total};
	}

	/** pass a null `year` to search all-time */
	async fsSearchYear(roomid: RoomID, year: string | null, search: string, limit?: number | null) {
		if (!limit || limit > MAX_RESULTS) limit = MAX_RESULTS;
		const log = await LogReader.get(roomid);
		if (!log) return {results: {}, total: 0};
		let months = await log.listMonths();
		months = months.reverse();
		const results: {[k: string]: SearchMatch[]} = {};
		let total = 0;

		for (const month of months) {
			if (year && !month.includes(year)) continue;
			const monthSearch = await this.fsSearchMonth(roomid, month, search, limit);
			const {results: monthResults, total: monthTotal} = monthSearch;
			if (!monthTotal) continue;
			total += monthTotal;
			Object.assign(results, monthResults);
			if (total > limit) break;
		}
		return {results, total};
	}

	async ripgrepSearch(roomid: RoomID, search: string, limit?: number | null) {
		let output;
		if (!limit || limit > MAX_RESULTS) limit = MAX_RESULTS;
		try {
			const options = [
				'-e', `[^a-zA-Z0-9]${search.split('').join('[^a-zA-Z0-9]*')}([^a-zA-Z0-9]|\\z)`,
				`${__dirname}/../../logs/chat/${roomid}`,
				'-C', '3',
				'-m', `${limit}`,
			];
			output = await execFile('rg', options, {maxBuffer: Infinity, cwd: path.normalize(`${__dirname}/../`)});
		} catch (error) {
			if (error.message.includes('Command failed')) return LogViewer.error(`No results found.`);
			return LogViewer.error(`${error.message}`);
		}
		return this.render(
			output.stdout.split('--').reverse(),
			roomid,
			search,
			limit
		);
	}

	render(results: string[], roomid: RoomID, search: string, limit: number) {
		const exactMatches = [];
		let curDate = '';
		if (limit > MAX_RESULTS) limit = MAX_RESULTS;
		const searchRegex = new RegExp(search, "i");
		const sorted = results.sort().map(chunk => {
			const section = chunk.split('\n').map(line => {
				const sep = line.includes('.txt-') ? '.txt-' : '.txt:';
				const [name, text] = line.split(sep);
				const rendered = LogViewer.renderLine(text, 'all');
				if (!rendered || name.includes('today') || !toID(line)) return '';
				 // gets rid of some edge cases / duplicates
				let date = name.replace(`${__dirname}/../../logs/chat/${roomid}`, '').slice(9);
				let matched = (
					searchRegex.test(rendered) ? `<div class="chat chatmessage highlighted">${rendered}</div>` : rendered
				);
				if (curDate !== date) {
					curDate = date;

					date = `</div></details><details open><summary>[<a href="view-chatlog-${roomid}--${date}">${date}</a>]</summary>`;
					matched = `${date} ${matched}`;
				} else {
					date = '';
				}

				if (matched.includes('chat chatmessage highlighted')) {
					exactMatches.push(matched);
				}
				if (exactMatches.length > limit) return null;
				return matched;
			}).filter(Boolean).join(' ');
			return section;
		});
		let buf = `<div class ="pad"><strong>Results on ${roomid} for ${search}:</strong>`;
		buf += !limit ? ` ${exactMatches.length}` : '';
		buf += !limit ? `<hr></div><blockquote>` : ` (capped at ${limit})<hr></div><blockquote>`;
		buf += sorted.filter(Boolean).join('<hr>');
		if (limit) {
			buf += `</details></blockquote><div class="pad"><hr><strong>Capped at ${limit}.</strong><br>`;
			buf += `<button class="button" name="send" value="/sl ${search},${roomid},${limit + 200}">View 200 more<br />&#x25bc;</button>`;
			buf += `<button class="button" name="send" value="/sl ${search},${roomid},all">View all<br />&#x25bc;</button></div>`;
		}
		return buf;
	}
};

const accessLog = FS(`logs/chatlog-access.txt`).createAppendStream();

export const pages: PageTable = {
	async chatlog(args, user, connection) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		if (!user.trusted) {
			return LogViewer.error("Access denied");
		}
		let [roomid, date, opts] = Chat.splitFirst(args.join('-'), '--', 2) as
			[RoomID, string | undefined, string | undefined];
		if (!roomid || roomid.startsWith('-')) {
			this.title = '[Logs]';
			return LogViewer.list(user, roomid?.slice(1));
		}

		// permission check
		const room = Rooms.get(roomid);
		if (roomid.startsWith('spl') && roomid !== 'splatoon' && !user.can('rangeban')) {
			return LogViewer.error("SPL team discussions are super secret.");
		}
		if (roomid.startsWith('wcop') && !user.can('rangeban')) {
			return LogViewer.error("WCOP team discussions are super secret.");
		}
		if (room) {
			if (!room.checkModjoin(user) && !user.can('bypassall')) {
				return LogViewer.error("Access denied");
			}
			if (!user.can('lock') && !this.can('mute', null, room)) return;
		} else {
			if (!this.can('lock')) return;
		}

		void accessLog.writeLine(`${user.id}: <${roomid}> ${date}`);
		this.title = '[Logs] ' + roomid;
		/** null = no limit */
		let limit: number | null = null;
		let search;
		if (opts?.startsWith('search-')) {
			let [input, limitString] = opts.split('--limit-');
			input = input.slice(7);
			search = Dashycode.decode(input);
			if (search.length < 3) return LogViewer.error(`Too short of a search query.`);
			if (limitString) {
				limit = parseInt(limitString) || null;
			} else {
				limit = 500;
			}
			opts = '';
		}
		const isAll = (toID(date) === 'all' || toID(date) === 'alltime');

		const parsedDate = new Date(date as string);
		// this is apparently the best way to tell if a date is invalid
		if (isNaN(parsedDate.getTime()) && !isAll && date !== 'today') {
			return LogViewer.error(`Invalid date.`);
		}

		if (date && search) {
			this.title = `[Search] [${room}] ${search}`;
			if (Config.chatlogreader === 'fs' || !Config.chatlogreader) {
				return LogSearcher.fsSearch(roomid, search, date, limit);
			} else if (Config.chatlogreader === 'ripgrep') {
				return LogSearcher.ripgrepSearch(roomid, search, limit);
			} else {
				throw new Error(`Config.chatlogreader must be 'fs' or 'ripgrep'.`);
			}
		} else if (date) {
			if (date === 'today') {
				return LogViewer.day(roomid, LogReader.today(), opts);
			} else if (date.split('-').length === 3) {
				return LogViewer.day(roomid, parsedDate.toISOString().slice(0, 10), opts);
			} else {
				return LogViewer.month(roomid, parsedDate.toISOString().slice(0, 7));
			}
		} else {
			return LogViewer.room(roomid);
		}
	},
};

export const commands: ChatCommands = {
	chatlog(target, room, user) {
		const targetRoom = target ? Rooms.search(target) : room;
		const roomid = targetRoom ? targetRoom.roomid : target;
		this.parse(`/join view-chatlog-${roomid}--today`);
	},

	sl: 'searchlogs',
	searchlog: 'searchlogs',
	searchlogs(target, room) {
		target = target.trim();
		const [search, tarRoom, limit, date] = target.split(',').map(str => str.trim());
		if (!target) return this.parse('/help searchlogs');
		if (search.length < 3) return this.errorReply(`Too short of a search query.`);
		if (!search) return this.errorReply('Specify a query to search the logs for.');
		let limitString;
		if (/^[0-9]+$/.test(limit)) {
			limitString = `--limit-${limit}`;
		} else if (toID(limit) === 'all') {
			limitString = `--limit-all`;
		} else if (!limit) {
			limitString = ``;
		} else {
			return this.errorReply(`Cap must be a number or [all].`);
		}
		const currentMonth = Chat.toTimestamp(new Date()).split(' ')[0].slice(0, -3);
		const curRoom = tarRoom ? Rooms.search(tarRoom) : room;
		return this.parse(
			`/join view-chatlog-${curRoom}--${date ? date : currentMonth}--search-${Dashycode.encode(search)}${limitString}`
		);
	},

	searchlogshelp: [
		"/searchlogs [search], [room], [cap], [date] - searches logs in the current room for [search].",
		"A comma can be used to search for multiple words in a single line - in the format arg1, arg2, etc.",
		"If a [cap] is given, limits it to only that many lines. Defaults to 500.",
		"The delimiter | can be used to space searching for multiple terms.",
		"Date formatting is ISO formatting (YYYY-MM-DD.) E.g 2020-05, 2020, or `all`.",
		"Requires: % @ # &",
	],
};
