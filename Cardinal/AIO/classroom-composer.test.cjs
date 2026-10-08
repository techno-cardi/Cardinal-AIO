'use strict';
const assert=require('node:assert/strict');
const composer=require('./classroom-composer.js');
assert.deepEqual(composer.paragraphs('Bonjour!\n\nTexte 1\n\nTexte 2'),['Bonjour!','Texte 1','Texte 2']);
const fmt=composer.formatAnnouncement('Information','Bonjour!\n\nUn passage.\n\nUn autre passage.');
assert.equal((fmt.richHtml.match(/<br><br>/g)||[]).length,3);
assert.ok(fmt.richHtml.includes('<p>Bonjour!<br><br></p>'));
assert.equal(fmt.text,'Information\n\nBonjour!\n\nUn passage.\n\nUn autre passage.');
const injection=composer.formatAnnouncement('A&B', '« <img src=x onerror=alert(1)> »');
assert.ok(injection.richHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!injection.richHtml.includes('<img'));
assert.deepEqual(composer.groupOptions({pdcNativeClassroomGroupMapV1:{
  '32':{courseId:'321',alternateLink:'https://classroom.google.com/c/abc',courseName:'G32'},
  '31':{courseId:'123',alternateLink:'https://classroom.google.com/c/abc',courseName:'G31'},
  '51':{courseId:'',alternateLink:'https://classroom.google.com/c/abc'},
  '33':{courseId:'333',alternateLink:'https://example.com/x'}
}},'pdcNativeClassroomGroupMapV1').map(x=>x[0]),['31','32']);
assert.throws(()=>composer.formatAnnouncement(' ','\n \n'),/Aucun message/);
console.log('classroom-composer tests: 6 passed');