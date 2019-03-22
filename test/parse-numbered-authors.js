var _ = require('lodash');
var expect = require('chai').expect;
var fs = require('fs');
var rl = require('../index');

describe('RIS parser - numbered authors', function() {
	var resErr;
	var data = [];

	before(function(next) {
		this.timeout(60 * 1000);
		rl.parse(fs.readFileSync(__dirname + '/data/numbered-authors.ris', 'utf-8'))
			.on('error', function(err) {
				resErr = err;
				next();
			})
			.on('ref', function(ref) {
				data.push(ref);
			})
			.on('end', next);
	});

	it('should not raise an error', function() {
		expect(resErr).to.be.not.ok;
	});

	it('should have parsed the author array correctly', function() {
		expect(data).to.have.length(1);
		expect(data[0]).to.have.property('authors');
		expect(data[0].authors).to.be.an('array');
		expect(data[0].authors).to.be.deep.equal(['Nickell, Stephan', 'Beck, Florian', 'Scheres, Sjors HW', 'Korinek, Andreas', 'Förster, Friedrich', 'Lasker, Keren', 'Mihalache, Oana', 'Sun, Na', 'Nagy, István', 'Sali, Andrej']);
	});
});
