import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProspectOwnershipIndex } from './prospectOwnership.ts';
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const rows = [
  {season_year:2026,updated_at:'2026-01-01',fantasy_team_id:1,position:'PROSPECT',player:{player_api_id:'1',full_name:'Étienne One'}},
  {season_year:2027,updated_at:'2026-11-01',fantasy_team_id:2,position:'AP',player:{player_api_id:'1',full_name:'Étienne One'}},
  {season_year:2027,updated_at:'2026-11-02',fantasy_team_id:3,position:'PROSPECT',player:{player_api_id:'1',full_name:'Étienne One'}},
  {season_year:2027,updated_at:'2026-11-02',fantasy_team_id:4,position:'AP',player:{player_api_id:'1',full_name:'Étienne One'}},
  {season_year:2026,updated_at:'2026-01-01',fantasy_team_id:1,position:'C',player:{player_api_id:'2',full_name:'Same Name'}},
  {season_year:2027,updated_at:'2026-11-01',fantasy_team_id:2,position:'PROSPECT',player:{player_api_id:'3',full_name:'Same Name'}},
  {season_year:2028,updated_at:'2026-11-02',fantasy_team_id:null,position:'C',player:{player_api_id:'1',full_name:'Étienne One'}},
];
function original(name,id) {
  const matches=row => id?row.player?.player_api_id===String(id):normalize(row.player?.full_name||'')===normalize(name);
  const wasSigned=rows.some(row=>matches(row)&&Boolean(row.fantasy_team_id)&&!['PROSPECT','AP'].includes((row.position||'').toUpperCase()));
  const latest=rows.filter(row=>matches(row)&&Boolean(row.fantasy_team_id)).sort((a,b)=>b.season_year-a.season_year||b.updated_at.localeCompare(a.updated_at))[0];
  return {wasSigned,rights:latest&&['PROSPECT','AP'].includes((latest.position||'').toUpperCase())?latest.fantasy_team_id:null};
}
test('indexed ownership preserves IDs, normalized names, year/date precedence, ties and signed history',()=>{
  const index=createProspectOwnershipIndex(rows);
  for(const [name,id] of [['Etienne One',1],['ETIENNE ONE',undefined],['Same Name',2],['Same Name',3],['same-name',undefined],['Missing',undefined],['Wrong Name',1]]) {
    const expected=original(name,id);
    assert.equal(index.wasSigned(name,id),expected.wasSigned);
    assert.equal(index.rightsTeam(name,id),expected.rights);
  }
  assert.equal(index.rightsTeam('Etienne One',1),3);
  assert.equal(index.wasSigned('Same Name',3),false);
  assert.equal(index.wasSigned('Same Name'),true);
});
