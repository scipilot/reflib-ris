var _ = require('lodash').mixin({
	isStream: require('isstream'),
});
var async = require('async-chainable');
var events = require('events');

var _fieldTranslations = { // Map of RIS fields to RefLib fields
	'A1  ': {reflib: 'authors', isArray: true},
	'A2  ': {reflib: 'authors', isArray: true, split: true},
	'A3  ': {reflib: 'authors', isArray: true, split: true},
	'A4  ': {reflib: 'authors', isArray: true, split: true},
	'AB  ': {reflib: 'abstract'},
	'AU  ': {reflib: 'authors', isArray: true},
	'C1  ': {reflib: 'custom1'},
	'C2  ': {reflib: 'custom2'},
	'C3  ': {reflib: 'custom3'},
	'C4  ': {reflib: 'custom4'},
	'C5  ': {reflib: 'custom5'},
	'C6  ': {reflib: 'custom6'},
	'C7  ': {reflib: 'custom7'},
	'C8  ': {reflib: 'custom8'},
	'CA  ': {reflib: 'caption'},
	'CY  ': {reflib: 'address'},
	'DA  ': {reflib: 'date'},
	'DB  ': {reflib: 'database'},
	'DO  ': {reflib: 'doi'},
	'DP  ': {reflib: 'databaseProvider'},
	'EP  ': {reflib: 'endPage'},
	'ET  ': {reflib: 'edition'},
	'IS  ': {reflib: 'number'},
	'J1  ': {reflib: 'journal'},
	'JF  ': {reflib: 'journal'},
	'KW  ': {reflib: 'tags', isArray: true},
	'LA  ': {reflib: 'language'},
	'N1  ': {reflib: 'notes'},
	'N2  ': {reflib: 'abstract'},
	'SN  ': {reflib: 'isbn'},
	'SP  ': {reflib: 'startPage'},
	'T1  ': {reflib: 'title'},
	'TI  ': {reflib: 'title'},
	'TY  ': {reflib: 'type'},
	'VL  ': {reflib: 'volume'},
	'Y1  ': {reflib: 'date'},
};

var _fieldTranslationsReverse = _(_fieldTranslations) // Calculate the key/val lookup - this time with the key being the reflib key
	.map(function(tran, id) {
		tran.ris = id;
		return tran;
	})
	.mapKeys(function(tran) {
		return tran.reflib;
	})
	.value();

// Lookup object of RIS => RefLib types
var _typeTranslations = {
	// Place high-priority translations at the top (when we translate BACK we need to know which of multiple keys to prioritize)
	'ADVS': 'audiovisualMaterial',
	'JOUR': 'journalArticle',
	'PCOMM': 'personalCommunication',
	'VIDEO': 'filmOrBroadcast',

	// Low priority below this line
	'ABST': 'unknown',
	'AGGR': 'aggregatedDatabase',
	'ANCIENT': 'ancientText',
	'ART': 'artwork',
	'BILL': 'bill',
	'BLOG': 'blog',
	'BOOK': 'book',
	'CASE': 'case',
	'CHAP': 'bookSection',
	'CHART': 'chartOrTable',
	'CLSWK': 'classicalWork',
	'COMP': 'computerProgram',
	'CONF': 'conferenceProceedings',
	'CPAPER': 'conferencePaper',
	'CTLG': 'catalog',
	'DATA': 'dataset',
	'DBASE': 'onlineDatabase',
	'DICT': 'dictionary',
	'EBOOK': 'electronicBook',
	'ECHAP': 'electronicBookSection',
	'EDBOOK': 'editedBook',
	'EJOUR': 'electronicArticle',
	'ELEC': 'web',
	'ENCYC': 'encyclopedia',
	'EQUA': 'equation',
	'FIGURE': 'figure',
	'GEN': 'generic',
	'GOVDOC': 'governmentDocument',
	'GRANT': 'grant',
	'HEARING': 'hearing',
	'ICOMM': 'personalCommunication',
	'INPR': 'newspaperArticle',
	'JFULL': 'journalArticle',
	'LEGAL': 'legalRuleOrRegulation',
	'MANSCPT': 'manuscript',
	'MAP': 'map',
	'MGZN': 'magazineArticle',
	'MPCT': 'filmOrBroadcast',
	'MULTI': 'onlineMultimedia',
	'MUSIC': 'music',
	'NEWS': 'newspaperArticle',
	'PAMP': 'pamphlet',
	'PAT': 'patent',
	'RPRT': 'report',
	'SER': 'serial',
	'SLIDE': 'audiovisualMaterial',
	'SOUND': 'audiovisualMaterial',
	'STAND': 'standard',
	'STAT': 'statute',
	'THES': 'thesis',
	'UNPB': 'unpublished',
};
var _typeTranslationsReverse = _(_typeTranslations)
	.map(function(tran, id) {
		return {reflib: tran, ris: id};
	})
	.uniqBy('reflib')
	.mapKeys('reflib')
	.mapValues('ris')
	.value();

function parse(content) {
	var emitter = new events.EventEmitter();

	var parser = function(content) { // Perform parser in async so the function will return the emitter otherwise an error could be thrown before the emitter is ready
		var ref = {};
		var refField; // Currently appending ref field
		(content + "\nTY  - FAKE\n").split(/\n/).forEach(function(line) {
			var bits = /^(....)- (.*)$/.exec(_.trimEnd(line));
			if (bits) {
				if (bits[1] == 'TY  ') { // Start of new reference
					if (!_.isEmpty(ref)) {
						// Final reference cleanup {{{
						// Pages {{{
						if (ref.startPage || ref.endPage) {
							ref.pages = (ref.startPage && ref.endPage) ? ref.startPage + '-' + ref.endPage
								: (ref.startPage) ? ref.startPage
								: '?';
							delete ref.startPage;
							delete ref.endPage;
						}
						// }}}
						// Type {{{
						ref.type = ref.type && _typeTranslations[ref.type] ? _typeTranslations[ref.type] : 'unknown';
						// }}}
						// }}}
						emitter.emit('ref', _.mapValues(ref, function(v, k) {
							if (!_.isString(v)) return v;
							return _.trimEnd(v);
						}));
					}
					ref = {};
				}

				if (_fieldTranslations[bits[1]]) { // Only accept known fields
					refField = _fieldTranslations[bits[1]];
					if (refField.isArray) {
						if (!ref[refField.reflib]) ref[refField.reflib] = [];

						if (refField.split) {
							bits[2].split(/\s*,\s*/).forEach(function(i) { ref[refField.reflib].push(i) });
						} else {
							ref[refField.reflib].push(bits[2]);
						}
					} else {
						ref[refField.reflib] = bits[2];
					}
				} else {
					refField = null;
				}
			} else if (refField) {
				if (_.isArray(ref[refField.reflib])) {
					ref[refField.reflib].push(line);
				} else {
					ref[refField.reflib] += '\n' + line;
				}
			}
		});
		emitter.emit('end');
	};

	if (_.isString(content)) {
		setTimeout(function() { parser(content) });
	} else if (_.isBuffer(content)) {
		setTimeout(function() { parser(content.toString('utf-8')) });
	} else if (_.isStream(content)) {
		var buffer = '';
		content
			.on('data', function(data) {
				buffer += data.toString('utf-8');
			})
			.on('end', function() {
				parser(buffer);
			});
	} else {
		throw new Error('Unknown item type to parse: ' + typeof content);
	}

	return emitter;
};

function _pusher(stream, isLast, child, settings) {
	var buffer = '';
	buffer += 'TY  - ' + _typeTranslationsReverse[child.type || settings.defaultType] + '\n';
	delete child.type;

	if (child.pages) {
		var pages = child.pages.split(/-{1,2}/);
		child.startPage = pages[0];
		child.endPage = pages[1];
		delete child.pages
	}

	_(child)
		.omitBy(function(data, key) {
			return !_fieldTranslationsReverse[key]; // Known translation?
		})
		.forEach(function(data, key) {
			var field = _fieldTranslationsReverse[key];
			if (field.isArray) {
				data.map(function(item) {
					buffer += field.ris + '- ' + item + '\n';
				});
			} else {
				buffer += field.ris + '- ' + data + '\n';
			}
		})

	stream.write(_.trimEnd(buffer) + (!isLast ? '\n' : ''));
};

function output(options) {
	var settings = _.defaults(options, {
		stream: null,
		defaultType: 'journalArticle', // Assume this reference type if we are not provided with one
		content: [],
	});
	async()
		// Sanity checks {{{
		.then(function(next) {
			if (!settings.content) return next('No content has been provided');
			next();
		})
		// }}}
		// References {{{
		.then(function(next) {
			if (_.isFunction(settings.content)) { // Callback
				var batchNo = 0;
				var fetcher = function() {
					settings.content(function(err, data, isLast) {
						if (err) return emitter.error(err);
						if (_.isArray(data) && data.length > 0) { // Callback provided array
							data.forEach(function(d, dIndex) {
								_pusher(settings.stream, isLast && dIndex == data.length-1, d, settings);
							});
							setTimeout(fetcher);
						} else if(!_.isArray(data) && _.isObject(data)) { // Callback provided single ref
							_pusher(settings.stream, isLast, data, settings);
							setTimeout(fetcher);
						} else { // End of stream
							next();
						}
					}, batchNo++);
				};
				fetcher();
			} else if (_.isArray(settings.content)) { // Array of refs
				settings.content.forEach(function(d, dIndex) {
					_pusher(settings.stream, dIndex == settings.content.length -1, d, settings);
				});
				next();
			} else if (_.isObject(settings.content)) { // Single ref
				_pusher(settings.stream, true, data, settings);
				next();
			}
		})
		// }}}
		// Stream end {{{
		.then(function(next) {
			settings.stream.end();
			next();
		})
		// }}}
		// End {{{
		.end(function(err) {
			if (err) throw new Error(err);
		});
		// }}}

	return settings.stream;
}

module.exports = {
	output: output,
	parse: parse,
};
