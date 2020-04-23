const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const stream = require('stream');
const { StringDecoder } = require('string_decoder');

const defaultExecuteCallback = async (child) => {
};

const execute = (command, args = [], options, callback = defaultExecuteCallback, exitStatusThreshold = 1) => new Promise(async (resolve, reject) => {
  const child = spawn(command, args, options)
    .once('exit', async exitStatus => exitStatus >= exitStatusThreshold ? reject(exitStatus) : resolve(await promise))
    .once('error', reject);
  child.stdout && child.stdout.pipe(process.stdout);
  child.stderr && child.stderr.pipe(process.stderr);
  const promise = callback(child);
});
exports.execute = execute;

const stringify = async readStream => {
  const buffers = [];
  for await (const buffer of readStream) buffers.push(buffer);
  return Buffer.concat(buffers).toString().trim();
};
exports.stringify = stringify;

const substitute = (command, args = [], options, stdin) => new Promise(async (resolve, reject) => {
  const child = spawn(command, args, Object.assign({}, options, { stdio: [stdin, 'pipe', 'ignore'] }))
    .once('close', () => resolve(result))
    .once('error', reject);
  const result = await stringify(child.stdout);
});
exports.substitute = substitute;

exports.installGem = async (isStrict = true, ...gemNames) =>
  (async () => { console.log(`::group::Installing gems...`); })().then(async () => {
    return await Promise.all([
      (async () => {
        const gems = await (async (...gemNames) => {
          const gems = new Map(gemNames.map(gem => [gem, undefined]));

          const filename = 'Gemfile.lock';
          if (!fs.existsSync(filename)) return gems;

          const filter = new RegExp(`^ {4}(${gemNames.map(name => isStrict ? name : name + '\\b[\\w-]*').join('|')}) \\((.*)\\)$`);
          for await (const line of readline.createInterface(fs.createReadStream(filename))) {
            const [matches, key, value] = (filter.exec(line) || []);
            if (matches) gems.set(key, value);
          }
          return gems;
        })(...gemNames);

        await (async (gems, ...options) => {
          const args = ['install'].concat(options);
          for (const [gem, version] of gems) args.push(`${gem}${(version && ':' + version) || ''}`);
          return execute('gem', args);
        })(gems, '-N', '--user-install');
        return gems;
      })(),
      (async () => {
        const gempath = await substitute('gem', ['environment', 'gempath']);
        const paths = gempath.split(path.delimiter).map(gemdir => path.join(gemdir, 'bin'));
        process.env['PATH'] = [].concat(paths, process.env.PATH).join(path.delimiter);
      })()
    ]).then(([gems,]) => gems);
  }).finally(() => console.log(`::endgroup::`));

exports.LineTransformStream = class LineTransformStream extends stream.Transform {
  constructor(encoding) {
    super({
      writableObjectMode: true,
      transform: function (chunk, encoding, done) {
        try {
          const text = this.decoder.write(chunk);
          const lines = (this.buffer + text).split(os.EOL);
          const last = lines.pop();
          for (const line of lines) this.push(line);
          this.buffer = last;
          done();
        } catch (error) {
          done(error);
        }
      },
      flush: function (done) {
        try {
          const text = this.decoder.end();
          const lines = (this.buffer + text).split(os.EOL);
          const last = lines.pop();
          for (const line of lines) this.push(line);
          if (last.length) this.push(last);
          done();
        } catch (error) {
          done(error);
        }
      }
    });
    this.decoder = new StringDecoder(encoding);
    this.buffer = '';
  }
};
