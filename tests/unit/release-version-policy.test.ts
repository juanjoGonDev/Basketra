import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStableVersion, resolveReleaseVersion } from '../../scripts/release-version-policy.mjs';

test('stable release tags normalize with an optional v prefix',()=>{
  assert.deepEqual(parseStableVersion('v1.2.3'),{major:1,minor:2,patch:3,version:'1.2.3',tag:'v1.2.3'});
  assert.deepEqual(parseStableVersion('4.5.6'),{major:4,minor:5,patch:6,version:'4.5.6',tag:'v4.5.6'});
  assert.equal(parseStableVersion('v1.2.3-beta'),undefined);
  assert.equal(parseStableVersion('latest'),undefined);
});

test('release policy starts at 1.0.0 and increments only the highest stable patch',()=>{
  assert.deepEqual(resolveReleaseVersion([], 'abc'),{
    major:1,minor:0,patch:0,version:'1.0.0',tag:'v1.0.0',reused:false,
  });
  assert.deepEqual(resolveReleaseVersion([
    {tag_name:'v1.0.1',target_commitish:'old',draft:false,prerelease:false},
    {tag_name:'v1.2.4',target_commitish:'older',draft:false,prerelease:false},
    {tag_name:'v2.0.3-beta',target_commitish:'ignored',draft:false,prerelease:true},
    {tag_name:'v9.0.0',target_commitish:'ignored',draft:true,prerelease:false},
  ],'current'),{
    major:1,minor:2,patch:5,version:'1.2.5',tag:'v1.2.5',reused:false,
  });
});

test('reruns reuse the release already assigned to the same immutable commit',()=>{
  assert.deepEqual(resolveReleaseVersion([
    {tag_name:'v1.0.4',target_commitish:'current-sha',draft:false,prerelease:false},
    {tag_name:'v1.0.3',target_commitish:'previous',draft:false,prerelease:false},
  ],'current-sha'),{
    major:1,minor:0,patch:4,version:'1.0.4',tag:'v1.0.4',reused:true,
  });
});
