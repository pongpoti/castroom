import { isAllowedInDb, addAllowedUser } from '../src/lib/allowlist.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const ID = 'U' + 'a1b2c3d4'.repeat(4);

/** Records every call made to it; `rows` is what the next query returns. */
function fakeSql(rows = []) {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return rows;
  };
  sql.calls = calls;
  return sql;
}

/* ---- isAllowedInDb ------------------------------------------------------ */

{
  const sql = fakeSql([{ '?column?': 1 }]);
  eq('a row back means allowed', await isAllowedInDb(sql, ID), true);
  eq('queries with the given id', sql.calls[0].values, [ID]);
}

{
  const sql = fakeSql([]);
  eq('no row back means refused', await isAllowedInDb(sql, ID), false);
}

{
  const sql = fakeSql([{ '?column?': 1 }]);
  eq('a malformed id is refused before ever reaching the database',
     await isAllowedInDb(sql, 'not-a-line-id'), false);
  eq('and never queries at all', sql.calls.length, 0);
}

/* ---- addAllowedUser ------------------------------------------------------ */

{
  const sql = fakeSql([]);
  await addAllowedUser(sql, ID, 'สมชาย ใจดี');
  eq('inserts with the id and display name', sql.calls[0].values, [ID, 'สมชาย ใจดี']);
}

{
  const sql = fakeSql([]);
  await addAllowedUser(sql, ID, undefined);
  eq('a missing display name is stored as null, not undefined',
     sql.calls[0].values, [ID, null]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
