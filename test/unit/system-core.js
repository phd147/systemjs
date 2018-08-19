import './fixtures/enable-tracing';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { resolveIfNotPlainOrUrl } from '../../src/common';
import '../../src/features/registry.js';
import '../../src/system-core.js';

const fileUrlToPath = () => {};

const SystemLoader = System.constructor;

describe('Core API', function () {
  const loader = new SystemLoader();
  loader.resolve = x => x;

  it('Should be an instance of itself', function () {
    assert(loader instanceof SystemLoader);
  });

  it('Supports loading', async function () {    
    loader.instantiate = x => [[], _export => ({ execute () { _export('y', 42) } })];
    const x = await loader.import('x');
    assert.equal(x.y, 42);
  });
  
  it('Supports reloading cached modules', async function () {
    loader.instantiate = null;
    const x = await loader.import('x');
    assert.equal(x.y, 42);
  });

  it('Supports toStringTag on module namespaces', async function () {
    const x = await loader.import('x');
    assert.equal(x[Symbol.toStringTag], 'Module');
  });

  // TODO: namespace Object property definitions

  it('Supports System.register', async function () {
    loader.instantiate = x => {
      loader.register([], _export => ({ execute () { _export('y', 42) } }));
      return loader.getRegister();
    };
    const y = await loader.import('y');
    assert.equal(y.y, 42);
  });

  it('Supports createContext hook', async function () {
    loader.instantiate = x => {
      loader.register([], (_export, _context) => ({ execute () { _export('meta', _context.meta) } }));
      return loader.getRegister();
    };
    const createContext = loader.createContext;
    loader.createContext = function (id) {
      const context = createContext(id);
      context.meta.custom = 'yay';
      return context;
    };
    const x = await loader.import('meta-test');
    assert.equal(x.meta.custom, 'yay');
  });

  it('Supports tracing loads', async function () {
    loader.instantiate = x => [[], _export => ({ execute () { _export('y', 42) } })];
    const loaded = [];
    loader.onload = function (x) {
      loaded.push(x);
    };
    const z = await loader.import('z');
    assert.equal(z.y, 42);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0], 'z');
  });

  it('Supports tracing load failures', async function () {
    loader.instantiate = x => { throw new Error('Problem') };
    const errors = [];
    loader.onload = function (_id, err) {
      errors.push(err);
    };
    try {
      await loader.import('f');
      assert.fail('Should have caught');
    }
    catch (e) {
      assert.equal(e.err, errors[0].err);
    }
  });

  describe('Registry API', function () {
    it('Supports System.get', function () {
      assert.equal(loader.get('x').y, 42);
    });

    it('Supports System.delete', function () {
      loader.delete('x');
      assert.equal(loader.get('x'), undefined);
    });
  });
});

describe('Loading Cases', function() {
  const loader = new SystemLoader();
  const baseUrl = path.resolve('test/fixtures').replace(/\\/g, '/') + '/';
  loader.resolve = (id, parent) => resolveIfNotPlainOrUrl(id, parent || baseUrl);
  loader.instantiate = async function (path) {
    const source = await new Promise((resolve, reject) => fs.readFile(path, (err, source) => err ? reject(err) : resolve(source.toString())));
    global.System = loader;
    eval(source);
    return this.getRegister();
  };

  describe('Simple tests', function() {
    it('Should import a module', async function () {
      const m = await loader.import('./register-modules/no-imports.js');
      assert(m);
      assert.equal(m.asdf, 'asdf');
    });

    it('Should import a module cached', async function () {
      const m1 = await loader.import('./register-modules/no-imports.js');
      const m2 = await loader.import('./register-modules/no-imports.js');
      assert.equal(m1.asdf, 'asdf');
      assert.equal(m1, m2);
    });

    it('should import an es module with its dependencies', async function () {
      const m = await loader.import('./register-modules/es6-withdep.js');
      assert.equal(m.p, 'p');
    });

    it('should import without bindings', async function () {
      const m = await loader.import('./register-modules/direct.js');
      assert(!!m);
    });

    it('should support various es syntax', async function () {
      const m = await loader.import('./register-modules/es6-file.js');

      assert.equal(typeof m.q, 'function');

      let thrown = false;
      try {
        new m.q().foo();
      }
      catch(e) {
        thrown = true;
        assert.equal(e, 'g');
      }

      if (!thrown)
        throw new Error('Supposed to throw');
    });

    it('should resolve various import syntax', async function () {
      const m = await loader.import('./register-modules/import.js');
      assert.equal(typeof m.a, 'function');
      assert.equal(m.b, 4);
      assert.equal(m.c, 5);
      assert.equal(m.d, 4);
      assert.equal(typeof m.q, 'object');
      assert.equal(typeof m.q.foo, 'function');
    });

    it('should support import.meta.url', async function () {
      const m = await loader.import('./register-modules/moduleUrl.js');
      assert.equal(m.url, path.resolve('test/fixtures/register-modules/moduleUrl.js').replace(/\\/g, '/'));
    });
  });

  describe('Circular dependencies', function() {
    it('should resolve circular dependencies', async function () {
      const m1 = await loader.import('./register-modules/circular1.js');
      const m2 = await loader.import('./register-modules/circular2.js');

      assert.equal(m1.variable1, 'test circular 1');
      assert.equal(m2.variable2, 'test circular 2');

      assert.equal(m2.output, 'test circular 1');
      assert.equal(m1.output, 'test circular 2');
      assert.equal(m2.output1, 'test circular 2');
      assert.equal(m1.output2, 'test circular 1');

      assert.equal(m1.output1, 'test circular 2');
      assert.equal(m2.output2, 'test circular 1');
    });

    it('should update circular dependencies', async function () {
      const m = await loader.import('./register-modules/even.js');
      assert.equal(m.counter, 1);
      assert(m.even(10));
      assert.equal(m.counter, 7);
      assert(!m.even(15));
      assert.equal(m.counter, 15);
    });
  });

  describe('Loading order', function() {
    async function assertLoadOrder(module, exports) {
      const m = await loader.import('./register-modules/' + module);
      exports.forEach(function(name) {
        assert.equal(m[name], name);
      });
    }

    it('should load in order (a)', async function () {
      await assertLoadOrder('a.js', ['a', 'b']);
    });

    it('should load in order (c)', async function () {
      await assertLoadOrder('c.js', ['c', 'a', 'b']);
    });

    it('should load in order (s)', async function () {
      await assertLoadOrder('s.js', ['s', 'c', 'a', 'b']);
    });

    it('should load in order (_a)', async function () {
      await assertLoadOrder('_a.js', ['b', 'd', 'g', 'a']);
    });

    it('should load in order (_e)', async function () {
      await assertLoadOrder('_e.js', ['c', 'e']);
    });

    it('should load in order (_f)', async function () {
      await assertLoadOrder('_f.js', ['g', 'f']);
    });

    it('should load in order (_h)', async function () {
      await assertLoadOrder('_h.js', ['i', 'a', 'h']);
    });
  });

  describe('Export variations', function () {
    it('should resolve different export syntax', async function () {
      const m = await loader.import('./register-modules/export.js');
      assert.equal(m.p, 5);
      assert.equal(typeof m.foo, 'function');
      assert.equal(typeof m.q, 'object');
      assert.equal(typeof m.default, 'function');
      assert.equal(m.s, 4);
      assert.equal(m.t, 4);
      assert.equal(typeof m.m, 'object');
    });

    it('should resolve "export default"', async function () {
      const m = await loader.import('./register-modules/export-default.js');
      assert.equal(m.default(), 'test');
    });

    it('should support simple re-exporting', async function () {
      const m = await loader.import('./register-modules/reexport1.js');
      assert.equal(m.p, 5);
    });

    it('should support re-exporting binding', async function () {
      await loader.import('./register-modules/reexport-binding.js');
      const m = await loader.import('./register-modules/rebinding.js');
      assert.equal(m.p, 4);
    });

    it('should support re-exporting with a new name', async function () {
      const m = await loader.import('./register-modules/reexport2.js');
      assert.equal(m.q, 4);
      assert.equal(m.z, 5);
    });

    it('should support re-exporting', async function () {
      const m = await loader.import('./register-modules/export-star.js');
      assert.equal(m.foo, 'foo');
      assert.equal(m.bar, 'bar');
    });

    // TODO: Fix Babel output for this one
    // Plus add tests for reexporting live bindings, namespaces exported themselves with reexports with live bindings
    it.skip('should support re-exporting overwriting', async function () {
      var m = await loader.import('./register-modules/export-star2.js');
      assert.equal(m.bar, 'bar');
      assert.equal(typeof m.foo, 'function');
    });
  });

  describe('Errors', function () {
    const testPath = path.resolve('test/fixtures/register-modules').replace(/\\/g, '/') + '/';

    async function getImportError(module) {
      try {
        await loader.import(module);
        assert.fail('Should have failed');
      }
      catch(e) {
        return e.toString();
      }
    }

    it('Should throw if instantiate hook doesnt instantiate', async function () {
      const loader = new SystemLoader();
      loader.resolve = x => x;
      loader.instantiate = () => {};
      try {
        await loader.import('x');
        assert.fail('Should have failed');
      }
      catch (e) {
        assert.equal(e.toString().indexOf('Error: No instantiation\n  Loading x'), 0);
      }
    });

    it('should give a plain name error', async function () {
      var err = await getImportError('plain-name');
      assert.equal(err, 'Error: No resolution\n  Resolving plain-name');
    });

    it('should throw if on syntax error', async function () {
      var err = await getImportError('./register-modules/main.js');
      assert.equal(err, 'Error: dep error\n  Evaluating ' + testPath + 'deperror.js\n  Evaluating ' + testPath + 'main.js');
    });

    it('should throw what the script throws', async function () {
      var err = await getImportError('./register-modules/deperror.js');
      assert.equal(err, 'Error: dep error\n  Evaluating ' + testPath + 'deperror.js');
    });

    it('404 error', async function () {
      var err = await getImportError('./register-modules/load-non-existent.js');
      console.log(err);
      var lines = err.split('\n  ');
      assert(lines[0].startsWith('Error: '));
      assert(lines[0].endsWith('open \'' + testPath.replace(/\//g, path.sep) + 'non-existent.js\''));
      assert.equal(lines[1], 'Loading ' + testPath + 'non-existent.js');
      assert.equal(lines[2], 'Loading ' + testPath + 'load-non-existent.js');
    });
  });
});