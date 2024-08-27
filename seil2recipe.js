/*! seil2recipe.js v1.0.0
 * https://github.com/iij/seil2recipe
 *
 * Copyright (c) 2019 Internet Initiative Japan Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
 * IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

class Converter {
    constructor(seilconfig, target_device) {
        this.seilconfig  = seilconfig;
        this.conversions = [];
        this.note        = new Note(target_device);

        this.convert();
    }

    get recipe_config() {
        const lines = Array.prototype.concat.apply([], this.conversions.map(rl => rl.recipe));
        return beautify(lines);
    }

    convert() {
        const lines = this.seilconfig.trim().split("\n")

        lines.forEach((line, idx) => {
            const conv = new Conversion(line, idx + 1, this.note);
            const tokens = tokenize(line);
            if (tokens == null) {
                conv.badconfig("二重引用符(\")が閉じられていません。");
                this.conversions.push(conv);
                return;
            }

            try {
                let node = Converter.rules;
                for (let i = 0; i < tokens.length; i++) {
                    conv.label = tokens.slice(0, i + 1).join(' ');

                    var val = node[tokens[i]];
                    if (!val && node['*']) {
                        val = node['*'];
                    }

                    if (val instanceof Function) {
                        if (val.length == 1) {
                            val = val(tokens);
                        } else if (val.length == 2) {
                            val(conv, tokens);
                            break;
                        } else {
                            // XXX raise an error!
                        }
                    }

                    if (val instanceof Array) {
                        val.forEach(line => conv.recipe.push(line));
                        break;
                    } else if (val == 'deprecated') {
                        conv.deprecated();
                        break;
                    } else if (val == 'notsupported') {
                        conv.notsupported();
                        break;
                    } else if (typeof val == 'string') {
                        if (val != '') {
                            conv.recipe.push(val)
                        }
                        break;
                    } else if (val === undefined) {
                        conv.syntaxerror();
                        break;
                    } else {
                        node = val;
                        continue;
                    }
                }
                if (node instanceof Object && node['.']) {
                    node['.'](conv, tokens);
                }
            } catch (error) {
                if (this.note.dst.shortname != 'test') {
                    conv.exception(error)
                } else {
                    throw error;
                }
            }

            this.conversions.push(conv);
        });

        this.conversions.forEach((conv) => {
            conv.defers.forEach((fun) => {
                fun(conv);
            });
        });
        this.conversions.forEach((conv) => {
            conv.defers2.forEach((fun) => {
                fun(conv);
            });
        });

        const deferconv = new Conversion("", 0, this.note);
        Converter.defers.forEach((fun) => {
            fun(deferconv);
        });
        this.conversions.push(deferconv);
    }

    static defer(fun) {
        Converter.defers.push(fun);
    }
}

Converter.defers = [];


class Note {
    constructor(target_device) {
        this.indices = new Map();  // (prefix) -> (last index number)
        this.params  = new Map();
        this.ifindex = new Map();  // (prefix) -> (interface) -> (index)
        this.memo    = new Map();
        this.deps    = new DependencySet();
        this.dst     = new Device(target_device);

        this.memo.set('bridge.group', new Map());
        this.memo.set('floatlink.interfaces', []);
        this.memo.set('ike.peer.dynamic', []);
        this.memo.set('ike.preshared-key', {});
        this.memo.set('interface.l2tp.tunnel', {});
        this.memo.set('interface.pppac.max-session', new Map());
        this.memo.set('interface.router-advertisements', []);
        this.memo.set('qos.class', { 'default': 'root' });
        this.memo.set('resolver.address', []);

        if (target_device != 'ca10') {
            this.if_mappings = {
                'lan0': 'ge1',
                'lan1': 'ge0',
                'lan2': 'ge2',
                'lan3': 'ge3',
                'lan4': 'ge4',
                'lan5': 'ge5',
                'lan*': 'ge*'
            };
        } else {
            this.if_mappings = {  // CA10
                'lan0': 'ge5',
                'lan1': 'ge4',
                'lan2': 'ge0',
                'lan3': 'ge1',
                'lan4': 'ge2',
                'lan5': 'ge3',
                'lan*': 'ge*'
            };
        }

        //
        // Notes for tangled config parameters
        //
        this.anonymous_l2tp_transport = {
            enable: null,
            preshared_key: null,
            ifnames: []
        };
        this.napt = {  // napt and snapt entries
            global: null,
            ifnames: new Map(),  // (ifname) -> [ [key-prefix, conv], ... ]
            add: (ifname, prefix, conv) => {
                var a = this.napt.ifnames.get(ifname);
                if (a == undefined) {
                    a = [];
                    conv.note.napt.ifnames.set(ifname, a);
                }
                a.push([prefix, conv]);
            }
        };
    }

    get_memo(key) {
        return this.memo.get(key);
    }

    set_memo(key, value) {
        this.memo.set(key, value);
    }

    get_named_index(prefix) {
        var idx = this.indices.get(prefix);
        if (idx == null) {
            idx = 0;
        } else {
            idx += 1;
        }
        this.indices.set(prefix, idx);
        return `${prefix}${idx}`;
    }

    set_param(prefix, label, key, value) {
        if (!this.params[prefix]) {
            this.params[prefix] = {};
        }
        if (!this.params[prefix][label]) {
            this.params[prefix][label] = { '*NAME*': label };
        }
        this.params[prefix][label][key] = value;
    }
}

class Conversion {
    constructor(seil_line, lineno, note) {
        this.seil_line = seil_line
        this.lineno    = lineno;
        this.note      = note;

        this.recipe = [];
        this.errors = [];
        this.prefix = '';
        this.defers = [];
        this.defers2 = [];
    }

    get devname() {
        return this.note.dst.name;
    }

    // add a key/value pair of recipe config.
    add(key, value) {
        if (arguments.length == 1) {
            this.recipe.push(key);
        } else {
            if (value == null) {
                throw `add('${key}', null) !!`;
            } else if (value == '') {
                value = '""';
            } else if (value.match(/['"\\ ]/)) {
                value = '"' + value.replace(/(["\\])/g, "\\$1") +'"';
            }

            this.recipe.push(key + ": " + value);
        }
    }

    defer(fun) {
        this.defers.push(fun);
    }
    defer2(fun) {
        this.defers2.push(fun);
    }

    //
    // Conversion Utility
    //
    ifmap(old_name) {
        return this.note.if_mappings[old_name] || old_name;
    }

    set_ifmap(old_name, new_name) {
        this.note.if_mappings[old_name] = new_name;
    }

    missing(feature, nowarning) {
        // Note: this method returns true only if our device does not support
        // the feature but some device supports it.
        if (this.note.dst.shortname == 'test') {
            return false;
        }
        let f = CompatibilityList[feature];
        if (f == null) {
            return false;
        }
        var b;
        if (this.note.dst.gen == 'seil6') {
            b = (f[0] == 0);
        } else {
            b = (f[1] == 0);
        }
        if (b && !nowarning) {
            this.notsupported(feature);
        }
        return b;
    }

    time2sec(str) {
        const a = str.match(/^(?:([0-9]+)h)?(?:([0-9]+)m)?(?:([0-9]+)s?)?$/);
        var sec = parseInt(a[3], 10);
        if (a[2]) {
            sec += parseInt(a[1]) * 60;  // minutes
        }
        if (a[1]) {
            sec += parseInt(a[2]) * 60 * 60;  // hours
        }
        return String(sec);
    }

    //
    // Proxy methods
    //
    get deps() {
        return this.note.deps;
    }

    get_index(prefix, zero_origin) {
        var idx = this.note.indices.get(prefix);
        if (!zero_origin) {
            // 前後にコンフィグを追加しやすいように 100, 200, 300, ... とする。
            if (idx == null) {
                idx = 100;
            } else {
                idx += 100;
            }
        } else {
            // syslog.remote.server は 0 はじまりしか受け入れない。
            if (idx == null) {
                idx = 0;
            } else {
                idx += 1;
            }
        }
        this.note.indices.set(prefix, idx);
        return `${prefix}.${idx}`;
    }

    get_memo(key) {
        return this.note.get_memo(key);
    }

    get_named_index(prefix) {
        return this.note.get_named_index(prefix);
    }

    get_trap_index() {
        const name = 'snmp.trap.watch.trap-index';
        var idx = this.note.indices.get(name);
        if (idx) {
            idx += 1;
        } else {
            idx = 1;
        }
        this.note.indices.set(name, idx);
        return `${idx}`;
    }

    get_params(prefix) {
        const params = this.note.params[prefix];
        if (params) {
            return params;
        } else {
            return {};
        }
    }

    if2index(prefix, ifname, nocreate=false) {
        var ifmap = this.note.ifindex.get(prefix);
        if (ifmap == null) {
            if (nocreate) { return null; }
            ifmap = new Map();
            ifmap.set('*', 100);
            this.note.ifindex.set(prefix, ifmap);
        }
        var idx = ifmap.get(ifname);
        if (idx == null) {
            if (nocreate) { return null; }
            idx = ifmap.get('*');
            ifmap.set(ifname, idx);
            ifmap.set('*', idx + 100);
        }
        return idx;
    }

    ifindex_foreach(prefix, fun) {
        this.note.ifindex.get(prefix).forEach((idx, ifname) => {
            if (ifname != '*') {
                fun(ifname, idx);
            }
        });
    }

    is_bridge_member(ifname) {
        var found = false;
        this.get_memo('bridge.group').forEach(params => {
            if (params['members'].includes(ifname)) {
                found = true;
                return;
            }
        });
        return found;
    }

    // returns bridge interface name or null
    is_bridge_representive(ifname) {
        function bridge_repr_cmp(a, b) {
            const ma = a.match(/^(\w+?)(\d+)$/);
            const mb = b.match(/^(\w+?)(\d+)$/);
            if (ma[1] == mb[1]) {
                return Number(ma[2]) - Number(mb[2]);
            } else {
                const order = ['lan', 'vlan', 'l2tp'];
                return order.indexOf(ma[1]) - order.indexOf(mb[1]);
            }
        }
        var bridge_if = null;
        this.get_memo('bridge.group').forEach(params => {
            if (params['members'].includes(ifname)) {
                var repr = ifname;
                params['members'].forEach(mif => {
                    if (bridge_repr_cmp(mif, repr) < 0) {
                        repr = mif;
                    }
                });
                if (repr == ifname) {
                    bridge_if = params.bridge_if;
                }
                return;
            }
        });
        return bridge_if;
    }

    read_params(prefix, tokens, idx, defs) {
        const name = tokens[idx];
        const params = { '*NAME*': name };
        idx += 1;

        while (idx < tokens.length) {
            const pname = tokens[idx];
            var val = defs[pname];
            if (val == null) {
                this.badconfig(`unknown parameter: ${pname}`);
                idx += 1;
                continue;
            }
            if (val instanceof Object && val.key) {
                const pdef = val;
                var val = tokens[idx + 1];
                if (pdef.fun) {
                    val = pdef.fun(val);
                }
                if (val != null) {
                    params[pname] = val;
                    this.add(pdef.key, val);
                }
                idx += 2;
                continue;
            }
            if (val instanceof Function) {
                val = val.call(null, tokens[idx + 1]);
            }
            if (val == 'notsupported') {
                this.notsupported(pname);
                idx += 2;
            } else if (val == 'deprecated') {
                this.deprecated(pname);
                idx += 2;
            } else if (Number.isInteger(val)) {
                const num = val;
                if (num == 0) {
                    params[pname] = true;
                } else {
                    params[pname] = tokens.slice(idx + 1, idx + 1 + num);
                }
                idx += 1 + num;
            } else if (val == true) {
                params[pname] = tokens[idx + 1];
                idx += 2;
            } else if (typeof val == 'string' && !(defs[pname] instanceof Function)) {
                params[pname] = tokens[idx + 1];
                this.add(val, params[pname]);
                idx += 2;
            } else {
                params[pname] = val;
                idx += 2;
            }
        }

        if (prefix) {
            if (this.note.params[prefix] == null) {
                this.note.params[prefix] = {};
            }
            if (this.note.params[prefix][name] == null) {
                this.note.params[prefix][name] = params;
            } else {
                Object.assign(this.note.params[prefix][name], params);
            }
        }
        return params;
    }

    set_memo(key, value) {
        return this.note.set_memo(key, value);
    }

    set_param(prefix, label, key, value) {
        this.note.set_param(prefix, label, key, value);
    }

    natifname(seilif) {
        if (seilif) {
            return this.ifmap(seilif);
        } else {
            return this.ifmap('lan1');
        }
    }

    param2recipe(params, param_name, recipe_key, fun) {
        if (params[param_name]) {
            var val = params[param_name];
            if (fun) {
                val = fun(val);
            }
            this.add(recipe_key, val);
        }
    }

    //
    // Error reporting
    //

    badconfig(message, label) {
        if (label == null) {
            label = this.label;
        }
        this.errors.push(new Error('badconfig', message));
    }

    deprecated(label) {
        if (label === undefined) {
            label = this.label;
        }
        this.errors.push(new Error('deprecated', `"${label}" は廃止されました。`));
    }

    exception(error) {
        this.errors.push(new Error('exception', `コンフィグの誤りまたは内部エラーです。`, error));
    }

    notsupported(label) {
        if (label == null) {
            label = this.label;
        }
        this.errors.push(new Error('notsupported', `"${label}" は ${this.note.dst.name} ではサポートされていません。`));
    }

    syntaxerror(label) {
        if (label == null) {
            label = this.label;
        }
        this.errors.push(new Error('syntaxerror', `"${label}" は解釈できません。`));
    }

    warning(message, label) {
        if (label == null) {
            label = this.label;
        }
        this.errors.push(new Error('warning', message));
    }
}

class Device {
    constructor(shortname) {
        this.shortname = shortname;
        this.gen = ('w2' == shortname) ? 'seil6' : 'seil8';

        this.name = {
            'w2':    'SA-W2',
            'x4':    'SEIL/X4',
            'ayame': 'SEIL/x86 Ayame',
            'ca10':  'SEIL CA10',
        }[shortname];
    }
}

const CompatibilityList = {
    // feature                                          seil6 seil8
    'application-gateway http-proxy':                  [    0,    1 ],
    'application-gateway mode ftp':                    [    1,    0 ],
    'cbq':                                             [    0,    1 ],
    'dhcp6 relay':                                     [    0,    1 ],
    'dhcp6 server':                                    [    0,    1 ],
    'dialup-device ... device-option ux312nc-3g-only': [    1,    0 ],
    'dialup-device ... device-option ux312nc-lte-only':[    0,    0 ],
    'dialup-network':                                  [    1,    0 ],
    'filter6 add ... action forward':                  [    0,    1 ],
    'ike peer add ... check-level':                    [    0,    1 ],
    'ike peer add ... initial-contact disable':        [    0,    1 ],
    'ike peer add ... nat-traversal disable':          [    0,    1 ],
    'ike peer add ... responder-only':                 [    0,    1 ],
    'ike global-parameters':                           [    0,    1 ],
    'ipsec security-association add ... ipv6':         [    0,    1 ],
    'interface ... add dhcp6':                         [    0,    1 ],
    'interface ... add router-advertisement(s)':       [    0,    1 ],
    'interface pppac max-session unlimit':             [    0,    1 ],
    'nat6':                                            [    0,    1 ],
    'option ip fragment-requeueing off':               [    0,    1 ],
    'option ip monitor-linkstate off':                 [    0,    1 ],
    'option ip multipath-selection':                   [    0,    1 ],
    'option ip redirects on':                          [    0,    1 ],
    'option ipv6 fragment-requeueing off':             [    0,    1 ],
    'option ipv6 monitor-linkstate off':               [    0,    1 ],
    'option ipv6 redirects on':                        [    0,    1 ],
    'ppp authentication-method none':                  [    1,    0 ],
    'pppac option session-limit off':                  [    0,    1 ],
    'resolver server-priority':                        [    1,    0 ],
    'route dynamic rip':                               [    0,    1 ],
    'route6 dynamic ospf':                             [    0,    1 ],
    'route6 dynamic ripng':                            [    0,    1 ],
    'rtadvd':                                          [    0,    1 ],
    'sshd authorized-key admin':                       [    0,    1 ],
    'sshd hostkey':                                    [    0,    1 ],
    'sshd password-authentication enable':             [    0,    1 ],
    'syslog remote ipv6':                              [    0,    1 ],
    'telnetd':                                         [    0,    1 ],
    'terminal':                                        [    0,    1 ],
    'upnp.listen.[].interface':                        [    0,    1 ],
    'vrrp add ... watch':                              [    0,    1 ],
};

class Error {
    constructor(type, message, error=undefined) {
        this.type    = type;
        this.message = message;
        this.error   = error;
    }
}

class DependencySet {
    constructor() {
        this.floatlink = { url: null, iflist: [] };
    }

    add_floatlink_name_service(conv, url) {
        this.floatlink.url = { conv: conv, value: url };
        this.emit();
    }

    add_floatlink_iface(conv, ifname) {
        this.floatlink.iflist.push({ conv: conv, value: ifname})
        this.emit();
    }

    emit() {
        if (this.floatlink.url) {
            this.floatlink.iflist.forEach(iface => {
                iface.conv.add(`interface.${iface.value}.floatlink.name-service`, this.floatlink.url.value);
            });
            this.floatlink.iflist = [];
        }
    }
}

function tokenize(line) {
    const tokens = []
    let token = ""
    line = line.trim();
    while (line != "") {
        if (line[0] == '"') {
            const a = line.match(/"((?:\\\\|\\"|[^"])*?)"\s*/)
            if (a == null) {
                return null;  // unmatched double quotation marks.
            }
            token = a[1].replace(/\\(.)/g, "$1")
            line = line.slice(a[0].length)
        } else {
            const a = line.match(/(\S+)\s*/)
            token = a[1]
            line = line.slice(a[0].length)
        }
        tokens.push(token)
    }
    return tokens
}

function unquote(qstr) {
    if (qstr && qstr.match(/^".*"$/)) {
        return qstr.slice(1, qstr.length - 1).replace(/\\(.)/g, '$1');
    } else {
        return qstr;
    }
}

function beautify(recipe_lines) {
    const sorted = recipe_lines.sort((a, b) => {
        let i = 0;
        let j = 0;
        for (;;) {
            if (!a[i]) {
                if (!b[j]) {
                    return 0;
                } else {
                    return 1;
                }
            } else if (!b[j]) {
                retrun -1;
            }

            const ma = a.substring(i).match(/^\d+/g);
            const mb = b.substring(j).match(/^\d+/g);
            if (ma && mb) {
                const na = Number(ma[0]);
                const nb = Number(mb[0]);
                if (na != nb) {
                    return na - nb;
                }
                i += ma[0].length;
                j += mb[0].length;
                continue;
            } else {
                if (a[i] != b[j]) {
                    return a[i].localeCompare(b[j]);
                }
                i++;
                j++;
            }
        }
    });
    return sorted.map((line) => line + '\n').join('');
}

function on2enable(onoff) {
    if (onoff == 'on') {
        return 'enable';
    } else if (onoff == 'off') {
        return 'disable';
    }
}

function commaEach(str, fun) {
    if (str != null) {
        str.split(',').forEach(fun);
    }
}

Array.prototype.conv_aes = function() {
    return this.map(alg => (alg == "aes") ? "aes128" : alg).dedup();
};

Array.prototype.dedup = function() {
    return Array.from(new Set(this));
};

String.prototype.is_ipv4_address = function() {
    return this.includes('.');
};

//
// Conversion Rules
//

Converter.rules = {};

Converter.rules['application-gateway'] = {
    'bridging-interface': (conv, tokens) => {
        // application-gateway bridging-interface add ...
        const k1 = conv.get_index('application-gateway.input.ipv4.bridging');
        conv.add(`${k1}.interface`, conv.ifmap(tokens[3]));
    },
    'http-proxy': {
        'enable': (conv, tokens) => {
            if (conv.missing('application-gateway http-proxy')) { return; }
            conv.add('application-gateway.http-proxy.service', 'enable');
        },

        // application-gateway http-proxy accept-interface { any | none | <interface>,...}
        'accept-interface': (conv, tokens) => {
            if (conv.missing('application-gateway http-proxy')) { return; }
            commaEach(tokens[3], ifname => {
                if (ifname.match(/^(ppp|pppoe|wwan)\d+$/)) {
                    conv.notsupported(`accept-interface ${ifname}`);
                    return;
                }
                const k1 = conv.get_index('application-gateway.http-proxy.accept-interface');
                conv.add(`${k1}.interface`, conv.ifmap(ifname));
            });
        },

        'handoff-on-dns-failure': 'notsupported',

        // application-gateway http-proxy listen-port { none | <port> }
        'listen-port': (conv, tokens) => {
            if (conv.missing('application-gateway http-proxy')) { return; }
            conv.add('application-gateway.http-proxy.listen-port', tokens[3]);
        }
    },
    'input-interface': (conv, tokens) => {
        // application-gateway input-interface add ...
        const ifname = tokens[3];
        if (! ifname.match(/^(ipsec|lan|pppac|tunnel|vlan)[0-9*]+$/)) {
            conv.notsupported(`input-interface ${ifname}`);
            return;
        }
        const k1 = conv.get_index('application-gateway.input.ipv4.gateway');
        conv.add(`${k1}.interface`, conv.ifmap(tokens[3]));
    },
    'service': {
        'add': (conv, tokens) => {
            const k1 = conv.get_index('application-gateway.service');
            const params = conv.read_params(`appgw.service`, tokens, 3, {
                'mode': true,
                'destination-port': `${k1}.destination.port`,
                'destination': `${k1}.destination.ipv4.address`,
                'idle-timer': true,
                'handoff': true,
                'handoff-address': true,
                'handoff-port': true,
                'handoff-for': true,
                'http-allow-method': 'notsupported',
                'http-referer-removal': 'notsupported',
                'http-referer-removal-pattern': 'notsupported',
                'http-hostname-verification': 'notsupported',
                'ftp-data-command': true,
                'ftp-data-port': true,
                'source-selection': `${k1}.source-selection.ipv4`,
                'logging': true,
                'label': 'notsupported',
                'url-filter': true,
            });

            if (params['mode'] == 'http' ||
                params['mode'] == 'ssl' ||
                params['mode'] == 'ftp' && !conv.missing('application-gateway mode ftp', true)) {
                conv.param2recipe(params, 'mode', `${k1}.mode`);
            } else {
                conv.notsupported(`mode ${params['mode']}`);
                return;
            }

            if (params['idle-timer'] == 'none') {
                conv.notsupported('idle-timer none');
            } else {
                conv.param2recipe(params, 'idle-timer', `${k1}.idle-timer`);
            }

            if (params['handoff'] == 'on') {
                conv.param2recipe(params, 'handoff-address', `${k1}.handoff.ipv4.address`);
                conv.param2recipe(params, 'handoff-port', `${k1}.handoff.port`);
                conv.param2recipe(params, 'handoff-for', `${k1}.handoff.hostname.pattern`);
            }

            commaEach(params['ftp-data-command'], c => {
                const k2 = conv.get_index(`${k1}.ftp.data`);
                conv.add(`${k2}.command`, c);
            });
            conv.param2recipe(params, 'ftp-data-port', `${k1}.ftp.data.port`);

            commaEach(params['logging'], l => {
                const k2 = conv.get_index(`${k1}.logging`);
                conv.add(`${k2}.event`, l);
            });

            conv.param2recipe(params, 'url-filter', `${k1}.url-filter`, on2enable);
        }
    },
    'url-filter': {
        'add': (conv, tokens) => {
            const k1 = conv.get_index('application-gateway.url-filter');
            const params = conv.read_params(null, tokens, 3, {
                'url-category': true,
                'url-pattern': true,
                'action': true,
                'source': true,
            });

            conv.param2recipe(params, 'action', `${k1}.action`);
            conv.param2recipe(params, 'source', `${k1}.source.ipv4.address`);
            conv.param2recipe(params, 'url-category', `${k1}.url.category`);
            conv.param2recipe(params, 'url-pattern', `${k1}.url.pattern`);
        },
        'external': 'notsupported',
        'option': {
            'block-ip-address-access': (conv, tokens) => {
                conv.add('application-gateway.url-filter.block-ip-address-access', tokens[4]);
            },
            'redirect-url-on-block': (conv, tokens) => {
                conv.add('application-gateway.url-filter.redirect-url-on-block', tokens[4]);
            },
        },
        'service': {
            // application-gateway url-filter service
            //   { site-umpire authentication-id <authentication_id> | none }
            'site-umpire': {
                'authentication-id': (conv, tokens) => {
                    conv.add('application-gateway.url-filter.service.100.name', 'site-umpire');
                    conv.add('application-gateway.url-filter.service.100.id', tokens[5]);
                }
            }
        }
    }
};

Converter.rules['arp'] = {
    // https://www.seil.jp/doc/index.html#fn/arp/cmd/arp.html#add
    'add': (conv, tokens) => {
        if (conv.missing('arp add')) { return; }
        const k = conv.get_index('arp');
        conv.add(`${k}.ipv4-address`, tokens[2]);
        conv.add(`${k}.mac-address`, tokens[3]);
        if (tokens[4] == 'proxy') {
            conv.add(`${k}.proxy`, on2enable(tokens[5]));
        }
    },

    // arp reply-nat { on | off }
    'reply-nat': (conv, tokens) => {
        conv.add('nat.ipv4.arpreply', on2enable(tokens[2]));
    }
};

Converter.rules['authentication'] = {
    'account-list': {
        '*': {
            'url': {
                '*': {
                    'interval': (conv, tokens) => {
                        // https://www.seil.jp/doc/index.html#fn/pppac/cmd/authentication_account-list.html
                        // https://www.seil.jp/sx4/doc/sa/pppac/config/interface.pppac.html
                        conv.set_memo(`authentication.realm.${tokens[2]}.url`, tokens[4]);
                        conv.set_memo(`authentication.realm.${tokens[2]}.interval`, tokens[6]);
                    }
                }
            }
        }
    },
    'local': {
        '*': {
            'user': {
                // https://www.seil.jp/doc/index.html#fn/pppac/cmd/authentication_local.html#user_add
                'add': (conv, tokens) => {
                    conv.read_params(`authentication.realm.${tokens[2]}.user`, tokens, 5, {
                        'password': true,
                        'framed-ip-address': true,
                        'framed-ip-netmask': true
                    });
                }
            }
        }
    },
    'radius': {
        // authentication radius <realm> ...
        '*': {
            // authentication radius <realm_name> accounting-server
            //     add <IPv4address> secret <secret>
            //     [port { <port> | system-default }]
            'accounting-server': (conv, tokens) => {
                conv.read_params(`authentication.realm.${tokens[2]}.accounting-server`, tokens, 5, {
                    'port': true,
                    'secret': true
                });
            },
            // authentication radius <realm_name> authentication-server
            //     add <IPv4address> secret <secret>
            //     [port { <port> | system-default }]
            'authentication-server': (conv, tokens) => {
                conv.read_params(`authentication.realm.${tokens[2]}.authentication-server`, tokens, 5, {
                    'port': true,
                    'secret': true
                });
            },
            'request-timeout': (conv, tokens) => {
                const realm = tokens[2];
                const num = tokens[4];
                conv.set_memo(`authentication.realm.${realm}.request-timeout`, num);
            },
            'max-tries': (conv, tokens) => {
                const realm = tokens[2];
                const num = tokens[4];
                conv.set_memo(`authentication.realm.${realm}.max-tries`, num);
            }
        }
    },
    'realm': {
        'add': {
            '*': {
                'type': (conv, tokens) => {
                    conv.read_params('authentication.realm', tokens, 3, {
                        'type': true,
                        'username-suffix': true
                    });
                }
            }
        }
    }
};

Converter.rules['bridge'] = {
    // https://www.seil.jp/doc/index.html#fn/bridge/cmd/bridge.html#enable
    'disable': [],
    'enable': (conv, tokens) => {
        const bridge_if = conv.get_named_index('bridge');
        conv.set_memo('bridge.enable', true);
        conv.add(`interface.${bridge_if}.member.100.interface`, conv.ifmap('lan0'));
        conv.add(`interface.${bridge_if}.member.200.interface`, conv.ifmap('lan1'));
        conv.get_memo('bridge.group').set('*LEGACY*', {
            bridge_if: bridge_if,
            members: ['lan0', 'lan1']
        });
    },
    'ip-bridging': (conv, tokens) => {
        conv.set_memo('bridge.ip-bridging.off', tokens[2] == 'off');
        if (conv.get_memo('bridge.enable')) {
            conv.add('interface.bridge0.forward.ipv4', on2enable(tokens[2]));
        }
    },
    'ipv6-bridging': (conv, tokens) => {
        conv.set_memo('bridge.ipv6-bridging.off', tokens[2] == 'off');
        if (conv.get_memo('bridge.enable')) {
            conv.add('interface.bridge0.forward.ipv6', on2enable(tokens[2]));
        }
    },
    'pppoe-bridging': (conv, tokens) => {
        if (conv.get_memo('bridge.enable')) {
            conv.add('interface.bridge0.forward.pppoe', on2enable(tokens[2]));
        }
    },
    'default-bridging': (conv, tokens) => {
        if (conv.get_memo('bridge.enable')) {
            conv.add('interface.bridge0.forward.other', on2enable(tokens[2]));
        }
    },

    // bridge filter { on | off }
    'filter': (conv, tokens) => {
        conv.set_memo('bridge.filter', tokens[2] == 'on');
    },

    'vman-tpid': 'notsupported',

    // https://www.seil.jp/doc/index.html#fn/bridge/cmd/bridge_group.html#add
    'group': {
        'add': (conv, tokens) => {
            const bridge_if = conv.get_named_index('bridge');
            const params = conv.read_params('bridge.group', tokens, 3, {
                'aging-time': 'notsupported',
                'default-bridging': true,
                'forward-delay': true,
                'hello-time': true,
                'loop-detection': 'notsupported',
                'ip-bridging': true,
                'ipv6-bridging': true,
                'max-age': true,
                'pppoe-bridging': true,
                'priority': true,
                'stp': true,
            });
            conv.set_param('bridge.group', tokens[3], '*ifname*', bridge_if);
            conv.get_memo('bridge.group').set(tokens[3], {
                bridge_if: bridge_if,
                members: []
            });

            if (params['stp'] == 'on') {
                conv.notsupported('stp on');
                if (params['forward-delay']) {
                    conv.notsupported('forward-delay');
                }
                if (params['hello-time']) {
                    conv.notsupported('hello-time');
                }
                if (params['max-age']) {
                    conv.notsupported('max-age');
                }
                if (params['priority']) {
                    conv.notsupported('priority');
                }
            }

            const k = `interface.${bridge_if}.forward`;
            if (params['ip-bridging'] == 'off') {
                conv.add(`${k}.ipv4`, 'disable');
            }
            if (params['ipv6-bridging'] == 'off') {
                conv.add(`${k}.ipv6`, 'disable');
            }
            if (params['pppoe-bridging'] == 'off') {
                conv.add(`${k}.pppoe`, 'disable');
            }
            if (params['default-bridging'] == 'off') {
                conv.add(`${k}.other`, 'disable');
            }
        }
    },

    // https://www.seil.jp/doc/index.html#fn/bridge/cmd/bridge_interface.html
    // https://www.seil.jp/sx4/doc/sa/bridge/config/interface.bridge.html
    'interface': {
        '*': {
            'group': (conv, tokens) => {
                const member_if = tokens[2];
                const group_name = tokens[4];
                const bg = conv.get_params('bridge.group');
                if (bg == undefined) {
                    conv.badconfig(`bridge group が定義されていません。`);
                    return;
                }
                const params = bg[group_name];
                if (params == null) {
                    conv.badconfig(`bridge group "${group_name}" が定義されていません。`);
                    return;
                }
                const bridge_if = params['*ifname*'];
                const k = conv.get_index(`interface.${bridge_if}.member`);
                conv.add(`${k}.interface`, conv.ifmap(member_if));

                conv.get_memo('bridge.group').get(group_name).members.push(member_if);
            }
        }
    }
};

Converter.rules['cbq'] = {
    // cbq class add <name> parent <parent_name> pbandwidth <percent>
    //     [borrow { on | off }] [priority { normal | <priority> }]
    //     [maxburst { normal | <maxburst> }] [minburst { normal | <minburst> }]
    //     [packetsize { normal | <size> }] [maxdelay { normal | <delay> }]
    'class': (conv, tokens) => {
        if (conv.missing('cbq')) { return; }
        if (!conv.get_memo('qos.service')) {
            conv.add('qos.service', 'enable');
            conv.set_memo('qos.service', true);
        }
        const class_map = conv.get_memo('qos.class');
        const params = conv.read_params(null, tokens, 3, {
            'parent': true,
            'pbandwidth': true,
            'borrow': true,
            'priority': true,
            'maxburst': 'notsupported',
            'minburst': 'notsupported',
            'packetsize': 'notsupported',
            'maxdelay': 'notsupported',
        });
        conv.ifindex_foreach('qos.interface', (ifname, idx) => {
            const k1 = `qos.interface.${idx}`;
            const clname = conv.get_named_index('class');
            class_map[params['*NAME*']] = clname;
            const k2 = `${k1}.class.${clname}`;
            conv.param2recipe(params, '*NAME*', `${k2}.label`);
            conv.add(`${k2}.parent`, class_map[params['parent']]);

            const linkbandwidth = conv.get_memo('cbq.link-bandwidth');
            const percent = params['pbandwidth'];
            const mbps = (percent / 100) * linkbandwidth;
            if (Math.round(mbps * 100) % 100 != 0) {
                conv.warning(`${conv.devname} では 1Mbps より細かい指定はできません。`);
            }
            conv.add(`${k2}.bandwidth`, String(Math.round(mbps)));

            conv.param2recipe(params, 'borrow', `${k2}.borrow`, on2enable);
            conv.param2recipe(params, 'priority', `${k2}.priority`,
                prio => (prio == 'normal') ? 1 : prio);
        });
    },

    // cbq filter add <name> class <class_name>
    //  [length { any | <length_range> }]
    //  [vlan-id {any | <vlan_id_range>}]
    //  [vlan-pri { any | <vlan_priority_range>}]
    //  [category { ip | ipv6 | ether }] [tos { any | <tos/mask>} ]
    //  [protocol { any | tcp | tcp-ack | udp | icmp | ipv6-icmp | igmp | <protocol> }]
    //  [src { any | <src_IPaddress/prefixlen>}]
    //  [srcport { any | <src_port_range> }]
    //  [dst { any | <dst_IPaddress/prefixlen> }]
    //  [dstport { any | <dst_port_range> }]
    //  [mactype { any | arp | sna | <mactype>}]
    //  [enable | disable]
    'filter': (conv, tokens) => {
        if (conv.missing('cbq')) { return; }
        const class_map = conv.get_memo('qos.class');
        const params = conv.read_params(null, tokens, 3, {
            'class': true,
            'length': 'notsupported',
            'vlan-id': 'notsupported',
            'vlan-pri': 'notsupported',
            'category': true,
            'tos': true,
            'protocol': true,
            'src': true,
            'srcport': true,
            'dst': true,
            'dstport': true,
            'mactype': 'notsupported',
            'enable': 0,
            'disable': 0,
        });
        if (params['disable']) { return; }
        let cat;
        if (params['category'] == null || params['category'] == 'ip') {
            cat = 'ipv4';
        } else if (params['category'] == 'ipv6') {
            cat = 'ipv6';
        } else {
            conv.notsupported('category ether');
            return;
        }
        conv.ifindex_foreach('qos.interface', (ifname, idx) => {
            const k1 = conv.get_index(`qos.filter.${cat}`);
            conv.add(`${k1}.interface`, 'any');
            conv.add(`${k1}.direction`, 'out');
            conv.add(`${k1}.label`, params['*NAME*']);

            const cl_old = params['class'];
            const cl_new = class_map[cl_old];
            if (cl_new == null) {
                conv.badconfig(`${cl_old} は定義されていません。`);
                return;
            }
            conv.add(`${k1}.marking.qos-class`, cl_new);

            const proto = params['protocol'];
            if (proto) {
                if (proto == 'tcp-ack') {
                    conv.deprecated(`protocol tcp-ack`);
                    return;
                } else if (proto == 'ipv6-icmp') {
                    proto = '58';
                }
                conv.add(`${k1}.protocol`, proto);
            }

            conv.param2recipe(params, 'tos', `${k1}.tos`);
            if (params['src'] != 'any') {
                conv.param2recipe(params, 'src', `${k1}.source.address`);
            }
            conv.param2recipe(params, 'srcport', `${k1}.source.port`);
            if (params['dst'] != 'any') {
                conv.param2recipe(params, 'dst', `${k1}.destination.address`);
            }
            conv.param2recipe(params, 'dstport', `${k1}.destination.port`);
        });

    },

    // cbq link-bandwidth { 1Gbps | 100Mbps | 10Mbps }
    'link-bandwidth': (conv, tokens) => {
        var bw;
        if (tokens[2] == '1Gbps') {
            bw = 1000;
        } else if (tokens[2] == '100Mbps') {
            bw = 100;
        } else if (tokens[2] == '10Mbps') {
            bw = 10;
        } else {
            conv.syntaxerror();
        }
        conv.set_memo('cbq.link-bandwidth', bw);
    }
};

Converter.rules['certificate'] = {
    // certificate my add <name> certificate "<string>" private-key "<string>"
    'my': {
        'add': (conv, tokens) => {
            conv.read_params('certificate', tokens, 3, {
                'certificate': true,
                'private-key': true
            });
        }
    }
};

function dhcp_get_interface(conv, iftoken) {
    const mode = conv.get_memo('dhcp.mode');
    const ifname = conv.ifmap(iftoken);
    const idx1 = conv.if2index('dhcp.interface', ifname);
    if (conv.get_memo(`dhcp.interface.${idx1}`)) {
        return `dhcp.${mode}.${idx1}`;
    } else {
        return null;
    }
};

// https://www.seil.jp/doc/index.html#fn/dhcp/cmd/dhcp_server.html
Converter.rules['dhcp'] = {
    'disable': (conv, tokens) => {
        conv.set_memo('dhcp', 'disable');
    },

    'enable': (conv, tokens) => {
        conv.set_memo('dhcp', 'enable');
    },

    'interface': {
        '*': {
            'disable': (conv, tokens) => {
                if (conv.get_memo('dhcp.mode') == 'relay') {
                    return;
                }
            },

            // dhcp interface <i/f> dns add <IPv4address>
            'dns': (conv, tokens) => {
                const k1 = dhcp_get_interface(conv, tokens[2]);
                if (k1 == null) {
                    return;
                }
                const k2 = conv.get_index(`${k1}.dns`);
                conv.add(`${k2}.address`, tokens[5]);
            },

            'domain': (conv, tokens) => {
                // dhcp interface <i/f> domain <name>
                const k = dhcp_get_interface(conv, tokens[2]);
                if (k && tokens[4] != "") {
                    conv.add(`${k}.domain`, tokens[4]);
                }
            },

            'enable': (conv, tokens) => {
                const mode = conv.get_memo('dhcp.mode');
                const ifname = conv.ifmap(tokens[2]);
                const idx = conv.if2index('dhcp.interface', ifname);
                conv.set_memo(`dhcp.interface.${idx}`, true);
                conv.add(`dhcp.${mode}.${idx}.interface`, ifname);
            },

            'expire': (conv, tokens) => {
                const k = dhcp_get_interface(conv, tokens[2]);
                if (k) {
                    conv.add(`${k}.expire`, tokens[4]);
                }
            },

            'gateway': (conv, tokens) => {
                const k = dhcp_get_interface(conv, tokens[2]);
                if (k) {
                    conv.add(`${k}.gateway`, tokens[4]);
                }
            },

            'ignore-unknown-request': (conv, tokens) => {
                const k = dhcp_get_interface(conv, tokens[2]);
                if (k) {
                    conv.add(`${k}.ignore-unknown-request`, on2enable(tokens[4]));
                }
            },

            // dhcp interface <i/f> ntp add <IPv4address>
            'ntp': (conv, tokens) => {
                const k1 = dhcp_get_interface(conv, tokens[2]);
                if (k1 == null) {
                    return;
                }
                const k2 = conv.get_index(`${k1}.ntp`);
                conv.add(`${k2}.address`, tokens[5]);
            },

            // dhcp interface <i/f> pool <IPv4address>[/<prefixlen>] <count>
            'pool': (conv, tokens) => {
                const ifname = tokens[2];
                const k1 = dhcp_get_interface(conv, ifname);
                if (k1 == null) {
                    return;
                }

                // address のプレフィクス長はわからない場合があるが、count は常にわかるため、
                // 先に書き出しておく。
                conv.add(`${k1}.pool.count`, tokens[5]);

                var addr = tokens[4];
                if (!addr.includes('/')) {
                    const plen = conv.get_memo(`interface.${ifname}.prefixlen`);
                    if (plen == null) {
                        conv.badconfig('pool のプレフィクス長が不明です。');
                        return;
                    }
                    addr = `${addr}/${plen}`;
                }
                conv.add(`${k1}.pool.address`, addr);
            },

            'server': {
                'add': (conv, tokens) => {
                    const ifname = conv.ifmap(tokens[2]);
                    const idx1 = conv.if2index('dhcp.interface', ifname);
                    if (conv.get_memo(`dhcp.interface.${idx1}`) == null) {
                        // recipe では disable されているインタフェースはコンフィグに書いてはいけない。
                        return;
                    }
                    const k = conv.get_index(`dhcp.relay.${idx1}.server`);
                    conv.add(`${k}.address`, tokens[5]);
                },
            },

            // dhcp interface <i/f> static add <MACaddress> <IPv4address>
            'static': {
                'add': (conv, tokens) => {
                    if (conv.missing('dhcp interface ... static add')) { return; }
                    const k1 = dhcp_get_interface(conv, tokens[2]);
                    if (k1) {
                        const k2 = conv.get_index(`${k1}.static.entry`);
                        conv.add(`${k2}.mac-address`, tokens[5]);
                        conv.add(`${k2}.ip-address`, tokens[6]);
                    }
                },
                'external': {
                    'interval': (conv, tokens) => {
                        const k = dhcp_get_interface(conv, tokens[2]);
                        if (k) {
                            conv.add(`${k}.static.external.interval`, tokens[6]);
                        }

                    },
                    // dhcp interface <i/f> static external url <URL>
                    'url': (conv, tokens) => {
                        const k = dhcp_get_interface(conv, tokens[2]);
                        if (k) {
                            conv.add(`${k}.static.external.url`, tokens[6]);
                        }
                    },
                },
            },

            'wins-node': (conv, tokens) => {
                const k = dhcp_get_interface(conv, tokens[2]);
                if (k) {
                    conv.add(`${k}.wins-node.type`, tokens[4]);
                }
            },

            // dhcp interface <i/f> wins-server add <IPv4address>
            'wins-server': (conv, tokens) => {
                const k1 = dhcp_get_interface(conv, tokens[2]);
                if (k1) {
                    const k2 = conv.get_index(`${k1}.wins-server`);
                    conv.add(`${k2}.address`, tokens[5]);
                }
            },

            'wpad': (conv, tokens) => {
                if (conv.missing('dhcp interface ... wpad')) { return; }
                const k = dhcp_get_interface(conv, tokens[2]);
                if (k) {
                    conv.add(`${k}.wpad.url`, tokens[4]);
                }
            },
        },
    },

    'mode': {
        'relay': (conv, tokens) => {
            conv.set_memo('dhcp.mode', 'relay');
            conv.add('dhcp.relay.service', conv.get_memo('dhcp'));
        },
        'server': (conv, tokens) => {
            conv.set_memo('dhcp.mode', 'server');
            conv.add('dhcp.server.service', conv.get_memo('dhcp'));
        },
    },

};

function dhcp6_client_get_interface(conv, iftoken) {
    const ifname = conv.ifmap(iftoken);
    const idx = conv.if2index('dhcp6.client.interface', ifname);
    if (conv.get_memo(`dhcp6.client.${idx}`)) {
        return `dhcp6.client.${idx}`;
    } else {
        return null;
    }
};

function dhcp6_server_get_interface(conv, iftoken) {
    const ifname = conv.ifmap(iftoken);
    const idx1 = conv.if2index('dhcp6.server', ifname);
    if (conv.get_memo(`dhcp6.server.${idx1}`)) {
        return `dhcp6.server.${idx1}`;
    } else {
        return null;
    }
};

// https://www.seil.jp/doc/index.html#fn/dhcp/cmd/dhcp6_client.html
Converter.rules['dhcp6'] = {
    'client': {
        'disable': 'dhcp6.client.service: disable',
        'enable': 'dhcp6.client.service: enable',

        // dhcp6 client interface { <lan> | <ipsec> | <ppp> | <pppoe> | <tunnel> | <vlan> }
        'interface': {
            '*': {
                '.': (conv, tokens) => {
                    if (! conv.get_memo('dhcp6.client.multiple')) {
                        const ifname = conv.ifmap(tokens[3])
                        conv.set_memo('dhcp6.client.interface', ifname);
                        conv.add('dhcp6.client.100.interface', ifname);
                    }
                },

                'disable': false,

                'enable': (conv, tokens) => {
                    const ifname = conv.ifmap(tokens[3])
                    const idx = conv.if2index('dhcp6.client.interface', ifname);
                    conv.set_memo(`dhcp6.client.${idx}`, true);
                    conv.add(`dhcp6.client.${idx}.interface`, ifname);
                },

                'prefix-delegation': {
                    'add': (conv, tokens) => {
                        const subnet = conv.ifmap(tokens[6]);
                        const sla_id = conv.ifmap(tokens[8]);
                        const k1 = dhcp6_client_get_interface(conv, tokens[3]);
                        const idx2 = conv.if2index(k1, subnet);
                        const k2 = `${k1}.prefix-delegation.${idx2}`;
                        conv.add(`${k2}.subnet`, subnet);
                        conv.add(`${k2}.sla-id`, sla_id);

                        if (tokens[9] == 'interface-id') {
                            conv.add(`${k2}.interface-id`, tokens[10]);
                        }
                    },
                    'force-option': (conv, tokens) => {
                        const k1 = dhcp6_client_get_interface(conv, tokens[3]);
                        conv.add(`${k1}.prefix-delegation.force`, on2enable(tokens[6]));
                    },
                },
                'rapid-commit': 'notsupported',
                'reconf-accept': 'notsupported',
            },
        },

        // https://www.seil.jp/doc/index.html#fn/dhcp/cmd/dhcp6_client_multi.html#multiple
        // multiple の enable/disable で変換方法が大きく切り換わる。
        'multiple': (conv, tokens) => {
            conv.set_memo('dhcp6.client.multiple', (tokens[3] == 'enable'));
        },


        'prefix-delegation': {
            // dhcp6 client interface <i/f> prefix-delegation force-option <on>
            'force-option': (conv, tokens) => {
                conv.add(`dhcp6.client.100.prefix-delegation.force`, on2enable(tokens[6]));
            },

            // dhcp6 client prefix-delegation subnet <i/f> sla-id <sla-id>
            //     [ interface-id { <interface-id> | system-default } ] [ enable | disable ]
            'subnet': (conv, tokens) => {
                const subnet = conv.ifmap(tokens[4]);
                const sla_id = tokens[6];
                const params = conv.read_params(null, tokens, 6, {
                    'interface-id': true,
                    'enable': 1,
                    'disable': 1,
                });
                if (params['enable']) {
                    conv.add('dhcp6.client.100.prefix-delegation.100.subnet', subnet);
                    conv.add('dhcp6.client.100.prefix-delegation.100.sla-id', sla_id);
                    if (params['interface-id']) {
                        conv.add(`dhcp6.client.100.prefix-delegation.100.interface-id`, params['interface-id']);
                    }
                }
            },
        },

        // https://www.seil.jp/doc/index.html#fn/dhcp/cmd/dhcp6_client_multi.html#multiple
        // dhcp6 client primary-interface <i/f>
        'primary-interface': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[3])
            conv.if2index('dhcp6.client.interface', ifname);  // reserve ifindex
        },

        // dhcp6 client rapid-commit { on | off }
        'rapid-commit': tokens => `dhcp6.client.rapid-commit: ${on2enable(tokens[3])}`,

        'reconf-accept': tokens => `dhcp6.client.reconf-accept: ${on2enable(tokens[3])}`,
    },

    'relay': {
        'interface': {
            '*': {
                'disable': [],

                'enable': (conv, tokens) => {
                    if (conv.missing('dhcp6 relay')) { return; }
                    if (! conv.get_memo('dhcp6.relay.enable')) {
                            conv.set_memo('dhcp6.relay.enable', true);
                            conv.add('dhcp6.relay.service', 'enable');
                    }
                    const ifname = conv.ifmap(tokens[3]);
                    const idx1 = conv.if2index('dhcp6.relay', ifname);
                    conv.add(`dhcp6.relay.${idx1}.interface`, ifname);
                },

                // dhcp6 relay interface { <lan> | <vlan> } server add <ipaddr>
                'server': {
                    'add': (conv, tokens) => {
                        if (conv.missing('dhcp6 relay')) { return; }
                        const ifname = conv.ifmap(tokens[3]);
                        const idx1 = conv.if2index('dhcp6.relay', ifname, true);
                        if (idx1) {
                            const k1 = conv.get_index(`dhcp6.relay.${idx1}.server`);
                            conv.add(`${k1}.address`, tokens[6]);
                        }
                    }
                }
            }
        }
    },

    'server': {
        'interface': {
            '*': {
                'disable': [],

                'enable': (conv, tokens) => {
                    if (conv.missing('dhcp6 server')) { return; }
                    if (! conv.get_memo('dhcp6.server.enable')) {
                            conv.set_memo('dhcp6.server.enable', true);
                            conv.add('dhcp6.server.service', 'enable');
                    }

                    const ifname = conv.ifmap(tokens[3]);
                    const idx1 = conv.if2index('dhcp6.server', ifname);
                    conv.add(`dhcp6.server.${idx1}.interface`, ifname);
                    conv.set_memo(`dhcp6.server.${idx1}`, true);
                },

                // dhcp6 server interface <i/f> dns add { dhcp6 | <IPv6address> } [ from <interface> ]
                'dns': (conv, tokens) => {
                    const k1 = dhcp6_server_get_interface(conv, tokens[3]);
                    if (k1 == null) {
                        return;
                    }
                    const k2 = conv.get_index(`${k1}.dns`);
                    conv.add(`${k2}.address`, tokens[6]);
                    if (tokens[7] == 'from') {
                        conv.add(`${k2}.client-interface`, conv.ifmap(tokens[8]));
                    }
                },

                // dhcp6 server interface <i/f> domain add <name>
                'domain': (conv, tokens) => {
                    const k1 = dhcp6_server_get_interface(conv, tokens[3]);
                    if (k1 == null) {
                        return;
                    }
                    if (conv.get_memo(`${k1}.domain`)) {
                        conv.warning(`${conv.devname} では DHCP6 サーバで配布できるドメイン名は 1 つのみです。`);
                        return;
                    }
                    conv.set_memo(`${k1}.domain`, true);
                    conv.add(`${k1}.domain`, tokens[6]);
                },

                // dhcp6 server interface <i/f> preference <preference>
                'preference': (conv, tokens) => {
                    const k1 = dhcp6_server_get_interface(conv, tokens[3]);
                    if (k1 == null) {
                        return;
                    }
                    conv.add(`${k1}.preference`, tokens[5]);
                },

                // dhcp6 server interface <i/f> sntp add { dhcp6 | <IPv6address> } [ from <interface> ]
                'sntp': (conv, tokens) => {
                    const k1 = dhcp6_server_get_interface(conv, tokens[3]);
                    if (k1 == null) {
                        return;
                    }
                    const k2 = conv.get_index(`${k1}.sntp`);
                    conv.add(`${k2}.address`, tokens[6]);
                    if (tokens[7] == 'from') {
                        conv.add(`${k2}.client-interface`, conv.ifmap(tokens[8]));
                    }
                },
            },
        },
    },
};

Converter.rules['dialup-device'] = {
    'access-point': (conv, tokens) => {
        // dialup-device access-point add <name>
        //  [phone-number { <phone-number> | none }] [subaddress { <address> | none }]
        //  [apn <apn>] [cid { <cid> | none }]
        //  [pdp-type { ppp | ip | system-default }]
        const name = tokens[3];
        const params = conv.read_params('dialup-device.access-point', tokens, 3, {
            'phone-number': 'notsupported',
            'subaddress': 'notsupported',
            'apn': true,
            'cid': true,
            'pdp-type': true
        });
        if (params['pdp-type'] == 'ppp') {
            conv.notsupported('pdp-type ppp');
            delete params['pdp-type'];
            // it can be ignored.
        }
    },
    'keepalive-down-count': (conv, tokens) => {
        conv.set_memo('dialup-device.keepalive-down-count', tokens[2]);
    },
    'keepalive-send-interval': (conv, tokens) => {
        conv.set_memo('dialup-device.keepalive-send-interval', tokens[2]);
    },
    'keepalive-timeout': (conv, tokens) => {
        conv.set_memo('dialup-device.keepalive-timeout', tokens[2]);
    },
    '*': (conv, tokens) => {
        // dialup-device { <foma> | <emobile> | <softbank> | <kddi> | <mdm> }
        //  [connect-to { <access-point-name> | none }]
        //  [pin { <pin> | none }]
        //  [auto-reset-interval { auto | <interval> | none }]
        //  [auto-reset-fail-count { <count> | none }]
        // dialup-device <mdm>
        //  [authentication-method { pap | chap | none }]
        //  [username <username>] [password <password>]
        //  [auto-connect { always | ondemand | system-default }]
        //  [idle-timer { <idle-timer> | none }]
        //  [auto-reset-interval { auto | <interval> | none }]
        //  [auto-reset-fail-count { <count> | none }]
        // dialup-device { <foma> | <emobile> | <softbank> | <kddi> |<mdm> }
        //  keepalive add <IPv4address>
        // dialup-device <mdm> device-option ux312nc-3g-only { on | off }
        // dialup-device <mdm> device-option ux312nc-lte-only { enable | disable }
        const params = conv.read_params('dialup-device', tokens, 1, {
            'connect-to': true,
            'pin': true,
            'auto-reset-interval': 'notsupported',
            'auto-reset-fail-count': true,
            'authentication-method': true,
            'username': true,
            'password': true,
            'auto-connect': true,
            'idle-timer': true,
            'device-option': 2,
        });

        // Note: you cannot write 2 device-option's on the same line.
        const opt = params['device-option'];
        if (opt != null) {
            conv.set_param('dialup-device', tokens[1], opt[0], opt[1]);
        }
    }
};

Converter.rules['dialup-network'] = (conv, tokens) => {
    // dialup-network <dialup-network> connect-to { <IPaddress> | <hostname> | "" }
    //   [ipsec-preshared-key { <preshared-key> | "" }]
    if (conv.missing('dialup-network')) { return; }
    conv.read_params('dialup-network', tokens, 1, {
        'connect-to': true,
        'ipsec-preshared-key': true,
    });
};

Converter.rules['dns'] = {
    // https://www.seil.jp/doc/index.html#fn/dns_forwarder/cmd/dns_forwarder.html
    // https://www.seil.jp/sx4/doc/sa/dns-forwarder/config/dns-forwarder.html
    'forwarder': {
        'aaaa-filter': 'notsupported',

        // X4 は ppp, pppoe, wwan インタフェースで listen する機能を持たない。
        'accept-from-wan': 'deprecated',

        // dns forwarder add { dhcp | dhcp6 | ipcp | ipcp-auto | <IPaddress> }
        'add': (conv, tokens) => {
            const k1 = conv.get_index('dns-forwarder');
            if (tokens[3] == 'ipcp-auto') {
                conv.warning('"ipcp-auto" はサポートされていないため、"ipcp" に変換します。')
                conv.add(`${k1}.address`, 'ipcp');
            } else {
                conv.add(`${k1}.address`, tokens[3]);
            }
        },

        'disable': 'dns-forwarder.service: disable',

        'enable': [
            // XXX
            // 旧 SEIL ではデフォルトですべてのインタフェースを listen していた。
            // X4 では明示的に指定しないと listen しない。
            'dns-forwarder.service: enable',
            'dns-forwarder.listen.100.interface: ge*',
            'dns-forwarder.listen.200.interface: ipsec*',
            'dns-forwarder.listen.300.interface: tunnel*',
            'dns-forwarder.listen.400.interface: bridge*',
            'dns-forwarder.listen.500.interface: vlan*',
            'dns-forwarder.listen.600.interface: pppac*',
        ],

        'query-translation': 'notsupported',
    }
};

Converter.rules['encrypted-password'] = 'deprecated';

Converter.rules['encrypted-password-long'] = (conv, tokens) => {
    if (tokens[1] != 'admin') {
        conv.notsupported(`encrypted-password-long ${tokens[1]}`);
        return;
    }
    conv.add('login.admin.encrypted-password', tokens[2]);
};

Converter.rules['environment'] = {
    'login-timer': (conv, tokens) => {
        const login_timer = tokens[2];
        conv.defer((conv) => {
            if (login_timer != null) {
                if (conv.missing('terminal', true)) {
                    // ログインできない設定ならエラーを出さずに単に無視する。
                    if (conv.get_memo('sshd.enable') || conv.get_memo('telnetd.enable')) {
                        conv.notsupported('environment login-timer');
                    }
                    return;
                }
                conv.add('terminal.login-timer', login_timer);
            }
        });
    },
    'pager': tokens => `terminal.pager: ${on2enable(tokens[2])}`,
    'terminal': 'deprecated',
};

function convert_filter46(conv, tokens, ipver) {
    const params = conv.read_params(null, tokens, 2, {
        'interface': true,
        'direction': true,
        'action': value => {
            if (value == 'forward') {
                return 2;
            } else {
                return value;
            }
        },
        'protocol': true,
        'icmp-type': true,
        'application': value => {
            conv.deprecated('application');
        },
        'src': true,
        'srcport': true,
        'dst': true,
        'dstport': true,
        'ipopts': true,
        'exthdr': true,
        'state': true,
        'state-ttl': true,
        'keepalive': true,
        'logging': true,
        'label': true,
        'enable': 0,
        'disable': 0,
    });
    if (params['disable']) {
        return;
    }
    if (ipver == 6 && params['action'][0] == 'forward') {
        if (conv.missing('filter6 add ... action forward')) {
            return;
        }
    }

    function generate_filter(conv, params, k) {
        conv.param2recipe(params, 'interface', `${k}.interface`, val => conv.ifmap(val));
        conv.param2recipe(params, 'direction', `${k}.direction`, val => {
            if (val == 'in/out') {
                return 'inout';
            } else {
                return val;
            }
        });
        if (params['action'] == 'pass' || params['action'] == 'block') {
            conv.param2recipe(params, 'action', `${k}.action`);
        }

        if (params['protocol']) {
            conv.param2recipe(params, 'protocol', `${k}.protocol`);
        } else {
            if (params['srcport'] || params['dstport']) {
                conv.add(`${k}.protocol`, 'tcpudp');
            }
        }
        conv.param2recipe(params, 'icmp-type', `${k}.icmp-type`);
        conv.param2recipe(params, 'src', `${k}.source.address`);
        conv.param2recipe(params, 'srcport', `${k}.source.port`);
        conv.param2recipe(params, 'dst', `${k}.destination.address`);
        conv.param2recipe(params, 'dstport', `${k}.destination.port`);
        conv.param2recipe(params, 'ipopts', `${k}.ipopts`);
        conv.param2recipe(params, 'exthdr', `${k}.exthdr`);
        conv.param2recipe(params, 'state', `${k}.state`);
        conv.param2recipe(params, 'state-ttl', `${k}.state.ttl`);
        conv.param2recipe(params, 'keepalive', `${k}.keepalive`);
        conv.param2recipe(params, 'logging', `${k}.logging`);

        // label が設定されていない場合はエントリ名を label に設定する。
        if (params['label'] == null) {
            params['label'] = params['*NAME*'];
        }
        conv.param2recipe(params, 'label', `${k}.label`);
    }

    const ipv46 = (ipver == 4) ? 'ipv4' : 'ipv6';
    var k;
    var layer3_filter = true;
    if (conv.get_memo('bridge.filter')) {
        if (ipver == 4 && !conv.get_memo('bridge.ip-bridging.off') ||
            ipver == 6 && !conv.get_memo('bridge.ipv6-bridging.off')) {
            if (conv.is_bridge_member(params['interface'])) {
                k = conv.get_index(`filter.bridge.${ipv46}`);
                generate_filter(conv, params, k);

                const repr = conv.is_bridge_representive(params['interface']);
                if (repr) {
                    params['interface'] = repr;
                } else {
                    layer3_filter = false;
                }
            }
        }
    }

    if (layer3_filter) {
        if (params['action'] == 'pass' || params['action'] == 'block') {
            k = conv.get_index(`filter.${ipv46}`);
        } else { // action forward
            k = conv.get_index(`filter.forward.${ipv46}`);
            const gateway = params['action'][1];
            if (gateway == 'discard') {
                conv.notsupported('filter ... action forward discard');
                return;
            }
            if (ipver == 4 && params['direction'] == 'out') {
                conv.add(`${k}.interface`, 'any');
            }
            conv.add(`${k}.gateway`, gateway);
        }
        generate_filter(conv, params, k);
    }
}

Converter.rules['filter'] = {
    'add': (conv, tokens) => {
        // https://www.seil.jp/doc/index.html#fn/filter/cmd/filter.html#add
        // https://www.seil.jp/sx4/doc/sa/filter/config/filter.ipv4.html
        return convert_filter46(conv, tokens, 4);
    }
};

Converter.rules['filter6'] = {
    'add': (conv, tokens) => {
        // https://www.seil.jp/doc/index.html#fn/filter/cmd/filter6.html#add
        // https://www.seil.jp/sx4/doc/sa/filter/config/filter.ipv6.html

        return convert_filter46(conv, tokens, 6);
    }
};

// https://www.seil.jp/doc/#fn/floatlink/cmd/floatlink.html
Converter.rules['floatlink'] = {
    'ike': {
        'proposal': {
            // floatlink ike proposal dh-group <group>
            'dh-group': (conv, tokens) => {
                conv.add(`floatlink.ike.proposal.phase1.dh-group`, tokens[4]);
            },
            // floatlink ike proposal encryption <alg1>[,<alg2>,...]
            'encryption': (conv, tokens) => {
                tokens[4].split(",").conv_aes().forEach(alg => {
                    const k1 = conv.get_index('floatlink.ike.proposal.phase1.encryption');
                    conv.add(`${k1}.algorithm`, alg);
                });
            },
            // floatlink ike proposal hash {system-default | { sha1 | sha256 | sha512 },...}
            'hash': (conv, tokens) => {
                tokens[4].split(",").forEach(hash => {
                    const k1 = conv.get_index('floatlink.ike.proposal.phase1.hash');
                    conv.add(`${k1}.algorithm`, hash);
                });
            },
            // floatlink ike proposal hash {system-default | { sha1 | sha256 | sha512 },...}
            'lifetime-of-time': (conv, tokens) => {
                conv.add(`floatlink.ike.proposal.phase1.lifetime`, tokens[4]);
            },
        },
    },
    'ipsec': {
        'proposal': {
            'authentication-algorithm': (conv, tokens) => {
                tokens[4].split(",").forEach(hash => {
                    const k1 = conv.get_index('floatlink.ike.proposal.phase2.authentication');
                    conv.add(`${k1}.algorithm`, hash);
                });
            },
            'encryption-algorithm': (conv, tokens) => {
                tokens[4].split(",").conv_aes().forEach(alg => {
                    const k1 = conv.get_index('floatlink.ike.proposal.phase2.encryption');
                    conv.add(`${k1}.algorithm`, alg);
                });
            },
            'lifetime-of-time': (conv, tokens) => {
                conv.add(`floatlink.ike.proposal.phase2.lifetime-of-time`, tokens[4]);
            },
            'pfs-group': (conv, tokens) => {
                conv.add(`floatlink.ike.proposal.phase2.pfs-group`, tokens[4]);
            },
        },
    },

    'name-service': {
        // floatlink name-service add <url>
        // -> interface.ipsec[0-63].floatlink.name-service: <url>
        'add': (conv, tokens) => {
            // floatlink name-service は add で書くが、最大で一つしか設定
            // できないため上書きされる心配はしなくて良い。

            // seil3 系専用サーバの URL が書いてある場合は、汎用サーバの
            // URL に置き換える。
            let url = tokens[3].replace('floatlink-seil.', 'floatlink.');
            conv.deps.add_floatlink_name_service(conv, url);
        }
    },
    'route': 'notsupported',
};

Converter.rules['hostname'] = (conv, tokens) => {
    conv.add('hostname', tokens[1]);
};

Converter.rules['httpd'] = {
    'access': 'notsupported',

    'disable': [],

    // httpd { enable | disable }
    'enable': 'notsupported',

    'module': 'notsupported',
};

function ike_params(conv, tokens) {
    // ike interval 40s
    pdefs = {};
    function add(word, defval, is_time=false) {
        pdefs[word] = {
            key: `ike.${word}`,
            fun: val => {
                if (conv.missing('ike global-parameters', true)) {
                    if (is_time) {
                        val = conv.time2sec(val);
                    }
                    if (val != defval) {
                        conv.warning(`ike ${word} は ${conv.note.dst.name} ではサポートされていません。`);
                    }
                    return null;
                }
                // interval だけは受け入れる表記が異なる。
                if (word == 'interval') {
                    val = conv.time2sec(val);
                }
                return val;
            }
        }
    }
    add('auto-initiation', 'enable');
    add('dpd-interval', 20);
    add('dpd-maxfail', 5);
    add('exclusive-tail', 'enable');
    add('interval', 10);
    add('maximum-padding-length', 20);
    add('nat-keepalive-interval', 120);
    add('per-send', 1);
    add('phase1-timeout', 30, true);
    add('phase2-timeout', 30, true);
    add('randomize-padding-length', 'disable');
    add('randomize-padding-value', 'enable');
    add('retry', 5);
    add('strict-padding-byte-check', 'disable');
    conv.read_params(null, tokens, 0, pdefs);
}

Converter.rules['ike'] = {
    // ike auto-initiation { enable | disable | system-default }
    // https://www.seil.jp/sx4/doc/sa/ipsec/config/ipsec.sa.html
    // https://www.seil.jp/doc/index.html#fn/ipsec/cmd/ike_peer.html#add
    'peer': {
        'add': (conv, tokens) => {
            const params = conv.read_params('ike.peer', tokens, 3, {
                'exchange-mode': true,
                'proposals': true,
                'address': true,
                'port': 'notsupported',
                'check-level': true,
                'initial-contact': true,
                'my-identifier': val => {
                    if (val == 'address') {
                            return 1;
                    } else {
                            return 2;  // fqdn or user-fqdn
                    }
                },
                'peers-identifier': val => {
                    if (val == 'address') {
                            return 1;
                    } else {
                            return 2;  // fqdn or user-fqdn
                    }
                },
                'nonce-size': true,
                'variable-size-key-exchange-payload': 'notsupported',
                'tunnel-interface': true,
                'dpd': true,
                'esp-fragment-size': 'notsupported',
                'nat-traversal': true,
                'send-transport-phase2-id ': 'notsupported',
                'responder-only': true,
                'prefer-new-phase1': true,
            });
            if (conv.missing("ike peer add ... responder-only", true)) {
                if (params['responder-only'] == 'on') {
                    conv.notsupported("ike peer add ... responder-only on");
                }
                delete params['responder-only'];
            }

            conv.set_memo(`ike.peer.address.${params['address']}`, params);

            if (params['address'] == 'dynamic') {
                conv.get_memo('ike.peer.dynamic').push(params);
            }
        }
    },
    'preshared-key': {
        // ike preshared-key add <peers-identifier> <key>
        'add': (conv, tokens) => {
            const label = unquote(tokens[3]);
            conv.get_memo('ike.preshared-key')[label] = tokens[4];
        }
    },
    'proposal': {
        'add': (conv, tokens) => {
            // ike proposal add <name> authentication { preshared-key } encryption ... hash ...
            //     dh-group ... [lifetime-of-time ...]
            conv.read_params('ike.proposal', tokens, 3, {
                'authentication': true,
                'encryption': true,
                'hash': true,
                'dh-group': true,
                'lifetime-of-time': true
            });
        }
    },
    '*': ike_params
};

Converter.rules['interface'] = {
    // https://www.seil.jp/doc/index.html#fn/interface/cmd/interface_lan.html
    // https://www.seil.jp/sx4/doc/sa/ge/config/interface.ge.html
    '*': {
        'add': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);

            // interface <lan> add router-advertisement
            // interface <lan> add dhcp6
            var af, remote, val;
            switch (tokens[3]) {
                // interface <lan> add dhcp [classless-static-route <on/off>]
                case 'dhcp':
                    af = 'ipv4';
                    val = 'dhcp';
                    if (tokens[4] == 'classless-static-route') {
                        conv.notsupported('classless-static-route');
                    }
                    break;
                case 'dhcp6':
                    if (conv.missing('interface ... add dhcp6')) { return; }
                    af = 'ipv6';
                    val = 'dhcp6';
                    break;
                case 'router-advertisement':
                    const ralist = conv.get_memo('interface.router-advertisements');
                    ralist.push(ifname);
                    if (conv.missing('interface ... add router-advertisement(s)', true)) {
                        if (ralist.length > 1) {
                            conv.warning(`${conv.devname} では router-advertisement は 1 つのインタフェースにしか設定できません。`);
                            return;
                        }
                    }
                    af = 'ipv6';
                    val = 'router-advertisement';
                    break;
                default:
                    // interface <lan> add <IPaddress>[/<prefixlen>]
                    // interface <ipsec> add <IPaddress>[/<prefixlen>] remote <IPaddress>
                    if (tokens[3].is_ipv4_address()) {
                        af = 'ipv4';
                        if (tokens[3].includes('/') &&
                            conv.get_memo(`interface.${tokens[1]}.prefixlen`) == null) {
                                conv.set_memo(`interface.${tokens[1]}.prefixlen`, tokens[3].split('/')[1]);
                        }
                    } else {
                        af = 'ipv6';
                    }
                    val = tokens[3];
                    if (tokens[4] == 'remote') {
                        remote = tokens[5];
                    }
                    break;
            }
            if (conv.get_memo(`interface.${ifname}.${af}.address`)) {
                const k1 = conv.get_index(`interface.${ifname}.${af}.alias`);
                conv.add(`${k1}.address`, val);

            } else {
                conv.set_memo(`interface.${ifname}.${af}.address`, true);
                conv.add(`interface.${ifname}.${af}.address`, val);
                if (remote) {
                    conv.add(`interface.${ifname}.${af}.remote`, remote);
                }
            }
        },

        // interface <ifname> address は show config で出力される形式ではないが、これでだいたい動くので
        // 例外としてサポートする。
        'address': (conv, tokens) => {
            return Converter.rules['interface']['*']['add'](conv, tokens);
        },

        // https://www.seil.jp/doc/index.html#fn/interface/cmd/interface_pppac.html#bind-realm
        'bind-realm': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            tokens[3].split(",").forEach(realm_name => {
                const realm = conv.get_params('authentication.realm')[realm_name];
                const kauth = conv.get_index(`interface.${ifname}.authentication`);

                if (realm['type'] != 'local') {
                    conv.add(`${kauth}.type: ${realm['type']}`);
                }
                if (realm['username-suffix']) {
                    conv.add(`${kauth}.realm.suffix: ${realm['username-suffix']}`);
                }
                const user = conv.get_params(`authentication.realm.${realm_name}.user`);
                for (const name in user) {
                    const kuser = conv.get_index(`${kauth}.user`);
                    conv.add(`${kuser}.name: ${name}`);
                    conv.add(`${kuser}.password: ${user[name]['password']}`);
                    if (user[name]['framed-ip-address']) {
                        conv.add(`${kuser}.framed-ip-address: ${user[name]['framed-ip-address']}`);
                    }
                    if (user[name]['framed-ip-netmask']) {
                        conv.add(`${kuser}.framed-ip-netmask: ${user[name]['framed-ip-netmask']}`);
                    }
                }

                const url = conv.get_memo(`authentication.realm.${realm_name}.url`);
                const interval = conv.get_memo(`authentication.realm.${realm_name}.interval`);
                if (url) {
                    conv.add(`${kauth}.account-list.url: ${url}`);
                    conv.add(`${kauth}.account-list.interval: ${interval}`);
                }

                Object.entries(conv.get_params(`authentication.realm.${realm_name}.accounting-server`)).forEach(e => {
                    const addr = e[0]
                    const params = e[1];
                    const k2 = conv.get_index(`${kauth}.radius.accounting-server`);
                    conv.add(`${k2}.address`, addr);
                    conv.param2recipe(params, 'port', `${k2}.port`);
                    conv.param2recipe(params, 'secret', `${k2}.shared-secret`);
                });
                Object.entries(conv.get_params(`authentication.realm.${realm_name}.authentication-server`)).forEach(e => {
                    const addr = e[0]
                    const params = e[1];
                    const k2 = conv.get_index(`${kauth}.radius.authentication-server`);
                    conv.add(`${k2}.address`, addr);
                    conv.param2recipe(params, 'port', `${k2}.port`);
                    conv.param2recipe(params, 'secret', `${k2}.shared-secret`);
                });
                const timo = conv.get_memo(`authentication.realm.${realm_name}.request-timeout`);
                if (timo) {
                    conv.add(`${kauth}.radius.request.timeout: ${timo}`);
                }
                const retry = conv.get_memo(`authentication.realm.${realm_name}.max-tries`);
                if (retry) {
                    conv.add(`${kauth}.radius.request.retry: ${retry}`);
                }
            });
        },

        'bind-tunnel-protocol': (conv, tokens) => {
            // interface <pppac> bind-tunnel-protocol <protocol_config_name>,...
            const ifname = conv.ifmap(tokens[1]);
            const protocol = conv.get_params('pppac.protocol')[tokens[3]];
            if (protocol == null) {
                // it may be unsupported protocol
                return;
            }
            if (protocol['protocol'] == 'l2tp') {
                conv.add(`interface.${ifname}.l2tp.service: enable`);

                (protocol['authentication-method'] || 'mschapv2,chap').split(',').forEach(m => {
                    const k2 = conv.get_index(`interface.${ifname}.l2tp.authentication`);
                    conv.add(`${k2}.method`, m);
                });

                const k1 = `interface.${ifname}`;
                conv.param2recipe(protocol, 'accept-dialin', `${k1}.l2tp.accept-dialin`, on2enable);
                if (protocol['accept-interface'] != 'any') {
                    (protocol['accept-interface'] || "").split(',').forEach(name => {
                        const k2 = conv.get_index(`${k1}.l2tp.accept`);
                        conv.add(`${k2}.interface`, conv.ifmap(name));
                    });
                }
                conv.param2recipe(protocol, 'l2tp-keepalive-interval', `${k1}.l2tp.keepalive.interval`);
                conv.param2recipe(protocol, 'l2tp-keepalive-timeout', `${k1}.l2tp.keepalive.timeout`);
                conv.param2recipe(protocol, 'lcp-keepalive-interval', `${k1}.l2tp.lcp.keepalive.interval`);
                conv.param2recipe(protocol, 'lcp-keepalive-retry-interfval', `${k1}.l2tp.lcp.keepalive.retry.interval`);
                conv.param2recipe(protocol, 'mppe', `${k1}.l2tp.mppe.requirement`, val => {
                    if (val == 'require') {
                        return 'required';   // Note: we need to append the last 'd' char!
                    } else {
                        return val;
                    }
                });
                conv.note.anonymous_l2tp_transport.ifnames.push(ifname);

                conv.param2recipe(protocol, 'mru', `${k1}.l2tp.mru`);
                conv.param2recipe(protocol, 'tcp-mss-adjust', `${k1}.l2tp.tcp-mss-adjust`, on2enable);
                conv.param2recipe(protocol, 'idle-timer', `${k1}.l2tp.idle-timer`);
            } else if (protocol['protocol'] == 'sstp') {
                const k1 = `interface.${ifname}`;
                conv.add(`${k1}.sstp.service: enable`);

                (protocol['authentication-method'] || "mschapv2").split(',').forEach(m => {
                    if (m == 'eap-radius') { return; }
                    const k2 = conv.get_index(`${k1}.sstp.authentication`);
                    conv.add(`${k2}.method`, m);
                });
                if (protocol['accept-interface'] != 'any') {
                    (protocol['accept-interface'] || "").split(',').forEach(name => {
                        const k2 = conv.get_index(`${k1}.sstp.accept`);
                        conv.add(`${k2}.interface`, conv.ifmap(name));
                    });
                }

                const cert = conv.get_params('certificate')[protocol['certificate']];
                conv.add(`${k1}.sstp.certificate`, cert['certificate']);
                conv.add(`${k1}.sstp.private-key`, cert['private-key']);

                if (protocol['idle-timer'] != 'none') {
                    conv.param2recipe(protocol, 'idle-timer', `${k1}.sstp.idle-timer`);
                }
                if (protocol['lcp-keepalive'] != 'off') {
                    conv.param2recipe(protocol, 'lcp-keepalive-interval', `${k1}.sstp.lcp.keepalive.interval`);
                    conv.param2recipe(protocol, 'lcp-keepalive-retry-interval', `${k1}.sstp.lcp.keepalive.retry.interval`);
                }
                conv.param2recipe(protocol, 'mru', `${k1}.sstp.mru`);
                conv.param2recipe(protocol, 'sstp-keepalive-interval', `${k1}.sstp.keepalive.interval`);
                conv.param2recipe(protocol, 'sstp-keepalive-timeout', `${k1}.sstp.keepalive.timeout`);
                conv.param2recipe(protocol, 'tcp-mss-adjust', `${k1}.sstp.tcp-mss-adjust`, on2enable);
            }

            if (!conv.get_memo('interface.pppac.max-session').has(ifname)) {
                conv.get_memo('interface.pppac.max-session').set(ifname, 'default');
            }
        },

        'description': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            conv.add(`interface.${ifname}.description`, tokens[3]);
        },

        'floatlink': {
            'address-family': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.floatlink.address-family`, tokens[4]);
            },
            'dynamic-local-address': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.dynamic-local-address`, tokens[4]);
            },
            'dynamic-remote-address': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.dynamic-remote-address`, tokens[4]);
            },
            // interface <ipsec> floatlink floatlink-key { <key> | none }
            'floatlink-key': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.floatlink.key`, tokens[4]);
            },
            // interface <ipsec> floatlink ipv6 { disable | enable | system-default }
            'ipv6': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                if (tokens[4] == 'enable') {
                    conv.add(`interface.${ifname}.ipv6.forward`, 'pass');
                }
            },
            'my-address': (conv, tokens) => {
                // interface <ipsec> floatlink my-address { <interface> | <IPaddress> | none }
                const ifname = conv.ifmap(tokens[1]);
                if (tokens[4].is_ipv4_address()) {
                    conv.notsupported('my-address <IPaddress>');
                    return;
                }
                conv.add(`interface.${ifname}.floatlink.my-address`, conv.ifmap(tokens[4]));
            },
            'my-node-id': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.floatlink.my-node-id`, tokens[4]);

                // my-node-id は必須キーなので、このタイミングで書く。
                conv.deps.add_floatlink_iface(conv, ifname);
            },
            'nat-traversal': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.nat-traversal`, tokens[4]);
            },
            'peer-node-id': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.floatlink.peer-node-id`, tokens[4]);
            },
            'preshared-key': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.preshared-key`, tokens[4]);
            }
        },

        // interface <pppac> ipcp-configuration { none | <pppac_ipcp_config_name> }
        'ipcp-configuration': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            const ipcp = conv.get_params('pppac.ipcp-configuration')[tokens[3]];
            const pool = conv.get_params('pppac.pool')[ipcp['pool']];

            const address = pool['address'].split('/')[0];
            const count = 2 ** (32 - pool['address'].split('/')[1]);
            conv.add(`interface.${ifname}.ipcp.pool.100.address: ${address}`);
            conv.add(`interface.${ifname}.ipcp.pool.100.count: ${count}`);
            if (pool['type']) {
                conv.add(`interface.${ifname}.ipcp.pool.100.type: ${pool['type']}`);
            }
        },

        'l2tp': {
            'manual': 'notsupported',

            // interface <l2tp> l2tp <l2tp_name> remote-end-id <remote_end_id>
            '*': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.remote-end-id`, tokens[5]);

                const l2tp = conv.get_params('l2tp')[tokens[3]];
                conv.add(`interface.${ifname}.local-hostname`, conv.get_memo('l2tp.hostname'));
                conv.add(`interface.${ifname}.remote-hostname`, l2tp['hostname']);
                conv.add(`interface.${ifname}.local-router-id`, conv.get_memo('l2tp.router-id'));
                conv.add(`interface.${ifname}.remote-router-id`, l2tp['router-id']);
                conv.param2recipe(l2tp, 'hello-interval', `interface.${ifname}.hello-interval`);
                conv.param2recipe(l2tp, 'retry', `interface.${ifname}.retry`);
                conv.param2recipe(l2tp, 'cookie', `interface.${ifname}.cookie`, on2enable);
                conv.param2recipe(l2tp, 'password', `interface.${ifname}.password`);
            }
        },

        // interface <pppac> max-session <number_of_sessions>
        'max-session': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            const num    = tokens[3];

            conv.get_memo('interface.pppac.max-session').set(ifname, num);
            if (num == 'unlimit') {
                if (!conv.missing('interface pppac max-session unlimit')) {
                    conv.add(`interface.${ifname}.max-session`, 'none');
                }
            } else {
                conv.add(`interface.${ifname}.max-session`, num);
            }
        },

        'mdi': 'deprecated',

        // interface <lan> media {<media>|auto}
        'media': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            let media = tokens[3];
            if (conv.devname == 'SEIL/x86 Ayame') {
                if (media != 'auto') {
                    conv.notsupported(`media ${media}`);
                }
                conv.add(`interface.${ifname}.media`, 'auto');
            } else {
                switch (ifname) {
                    case 'ge0':
                        if (conv.devname == 'SEIL CA10') {
                            conv.add('interface.ge0.media', media);
                        } else {
                            conv.add('interface.ge0p0.media', media);
                        }
                        break;
                    case 'ge1':
                        if (conv.devname == 'SEIL CA10') {
                            conv.add('interface.ge1.media', media);
                        } else {
                            conv.add('interface.ge1p0.media', media);
                            conv.add('interface.ge1p1.media', media);
                            conv.add('interface.ge1p2.media', media);
                            conv.add('interface.ge1p3.media', media);
                        }
                        break;
                    case 'ge2':
                        if (conv.devname.startsWith('SA-')) {
                            // ignore it
                            break;
                        }
                        // devname must be 'SEIL/X4' here.
                        if (media == '10baseT' || media == '100baseTX') {
                            conv.notsupported(`ge2 media ${media}`);
                            media = 'auto';
                        }
                        conv.add('interface.ge2.media', media);
                        break;
                    case 'ge4':
                    case 'ge5':
                        if (media != '1000baseT-FDX' && media != 'auto') {
                            conv.notsupported(`${ifname} media ${media}`);
                            media = 'auto';
                        }
                        conv.add(`interface.${ifname}.media`, media);
                        break;
                    default:
                        conv.add(`interface.${ifname}.media`, media);
                        break;
                }
            }
        },

        'mtu': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            if (ifname.match(/^(ge|ipsec|pppoe|rac|tunnel)\d+$/)) {
                conv.add(`interface.${ifname}.mtu`, tokens[3]);
            } else {
                conv.notsupported(`interface.${ifname}.mtu`);
            }
        },

        // interface <ppp> over <device>
        // interface <pppoe> over <lan>
        'over': (conv, tokens) => {
            const device = tokens[3];
            const ifname = conv.ifmap(tokens[1]);
            const ddev = conv.get_params('dialup-device')[device];
            const dnet = conv.get_params('dialup-network')[device];
            if (device == 'lan1') {
                // default value for <pppoe>
            } else if (device.startsWith('lan')) {
                // non-default values for <pppoe>
                const ifname = conv.ifmap(tokens[1]);
                conv.add(`interface.${ifname}.over`, conv.ifmap(device));
            } else if (ddev != null) {
                // for <ppp>
                const k1 = `interface.${ifname}`;
                conv.add(`${k1}.dialup-device`, device);

                conv.param2recipe(ddev, 'authentication-method', `${k1}.auth-method`);
                conv.param2recipe(ddev, 'auto-connect', `${k1}.auto-connect`);
                conv.param2recipe(ddev, 'auto-reset-fail-count', `${k1}.auto-reset-fail-count`);
                conv.param2recipe(ddev, 'idle-timer', `${k1}.idle-timer`);
                conv.param2recipe(ddev, 'password', `${k1}.password`);
                conv.param2recipe(ddev, 'pin', `${k1}.pin`);
                conv.param2recipe(ddev, 'username', `${k1}.id`);

                if (ddev['ux312nc-3g-only'] == 'on') {
                    if (!conv.missing('dialup-device ... device-option ux312nc-3g-only')) {
                        conv.add(`${k1}.device-option.ux312nc-3g-only`, 'enable');
                    }
                }

                if (ddev['ux312nc-lte-only'] != null) {
                    conv.missing('dialup-device ... device-option ux312nc-lte-only');
                }

                const apname = ddev['connect-to'];
                const ap = conv.get_params('dialup-device.access-point')[apname];
                conv.param2recipe(ap, 'apn', `${k1}.apn`);
                conv.param2recipe(ap, 'cid', `${k1}.cid`);
                conv.param2recipe(ap, 'pdp-type', `${k1}.pdp-type`);

                const kto = conv.get_memo('dialup-device.keepalive-timeout');
                if (kto != null) {
                    conv.add(`${k1}.auto-reset-keepalive.reply-timeout`, kto);
                }

                // seil3 では (interval, count) の両方をそれぞれ設定したが、
                // seil6/8 ではその積である down-detect-time のみ設定する。
                var ksi = conv.get_memo('dialup-device.keepalive-send-interval');
                var kdc = conv.get_memo('dialup-device.keepalive-down-countl');
                if (ksi != null || kdc != null) {
                    if (ksi == null) ksi = '30';
                    if (kdc == null) kdc = '20';
                    const ddt = String(Number(ksi) * Number(kdc) / 60);
                    conv.add(`${k1}.auto-reset-keepalive.down-detect-time`, ddt);
                }
            } else if (dnet != null) {
                conv.set_ifmap(ifname, 'rac0');
                const k1 = `interface.rac0`;
                conv.param2recipe(dnet, 'connect-to', `${k1}.server.ipv4.address`);
                conv.param2recipe(dnet, 'ipsec-preshared-key', `${k1}.ipsec-preshared-key`);
            }
        },

        'ppp-configuration': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            const k1 = `interface.${ifname}`;
            const params = conv.get_params('ppp')[tokens[3]];
            conv.param2recipe(params, 'identifier', `${k1}.id`);
            conv.param2recipe(params, 'passphrase', `${k1}.password`);
            conv.param2recipe(params, 'ipcp', `${k1}.ipcp`);
            conv.param2recipe(params, 'ipcp-address', `${k1}.ipcp.address`, on2enable);
            conv.param2recipe(params, 'ipcp-dns', `${k1}.ipcp.dns`, on2enable);
            conv.param2recipe(params, 'ipv6cp', `${k1}.ipv6cp`);
            conv.param2recipe(params, 'tcp-mss', `${k1}.ipv4.tcp-mss`);
            conv.param2recipe(params, 'tcp-mss6', `${k1}.ipv6.tcp-mss`);
            conv.param2recipe(params, 'keepalive', `${k1}.keepalive`);

            // authentication-method
            const am = params['authentication-method'];
            if (am) {
                if (am == 'auto') {
                    // it's default.
                } else if (am == 'none' && ifname.match(/^ppp\d+$/) &&
                    !conv.missing('ppp authentication-method none', true)) {
                    conv.param2recipe(params, 'authentication-method', `${k1}.auth-method`);
                } else {
                    conv.notsupported(`ppp authentication-method ${params['authentication-method']}`);
                }
            }

            // auto-connect
            if (ifname.match(/^ppp\d+$/)) {
                if (params['auto-connect'] == 'vrrp') {
                    // ignored
                } else if (params['auto-connect'] == 'none') {
                    conv.notsupported('auto-connect none');
                } else {
                    conv.param2recipe(params, 'auto-connect', `${k1}.auto-connect`);
                }
            }
            if (ifname.match(/^pppoe\d+$/)) {
                if (params['auto-connect'] == 'vrrp') {
                    conv.notsupported('auto-connect vrrp');
                }
            }

            // idle-timer
            if (!ifname.match(/^pppoe\d+$/)) {
                conv.param2recipe(params, 'idle-timer', `${k1}.idle-timer`);
            }
        },

        'queue': {
            'normal': [],
            'cbq': (conv, tokens) => {
                if (conv.missing('cbq')) { return; }
                const ifname = conv.ifmap(tokens[1]);
                const idx1 = conv.if2index('qos.interface', ifname);
                const k1 = `qos.interface.${idx1}`;
                conv.add(`${k1}.interface`, ifname);
                conv.add(`${k1}.default-class`, 'root');
            }
        },

        // interface <vlan> tag <tag> [over <lan>]
        'tag': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            conv.add(`interface.${ifname}.vid`, tokens[3]);
            var over_if = conv.ifmap('lan0');
            if (tokens[4] == 'over') {
                over_if = conv.ifmap(tokens[5]);
            }
            conv.add(`interface.${ifname}.over`, over_if);
        },

        // interface <lan> tcp-mss { <size> | off | auto }
        // seil3 の "off" に相当する X4 コンフィグは "none" だが、"off" は show config で表示されない。
        'tcp-mss': (conv, tokens) => {
            conv.add(`interface.${conv.ifmap(tokens[1])}.ipv4.tcp-mss`, tokens[3]);
        },
        'tcp-mss6': (conv, tokens) => {
            conv.add(`interface.${conv.ifmap(tokens[1])}.ipv6.tcp-mss`, tokens[3]);
        },

        // interface <ipsec> tunnel <start_IPaddress> <end_IPaddress>
        // interface <tunnel> tunnel dslite <aftr>
        'tunnel': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            if (tokens[3] == 'dslite') {
                conv.add(`interface.${ifname}.ipv6.dslite.aftr`, tokens[4]);
            } else {
                var af;
                if (tokens[3].is_ipv4_address()) {
                    af = 'ipv4';
                } else {
                    af = 'ipv6';
                }
                conv.set_memo(`interface.${ifname}.tunnel.source`, tokens[3]);
                conv.set_memo(`interface.${ifname}.tunnel.destination`, tokens[4]);

                // "interface.ipsec.dst" は ike peer から参照する。
                if (ifname.substr(0, 5) == 'ipsec') {
                    conv.set_memo(`interface.ipsec.dst.${tokens[4]}`, ifname);
                }

                // "interface.l2tp.tunnel"
                if (ifname.substr(0, 4) == 'l2tp') {
                    const pair = `${tokens[3]}->${tokens[4]}`;
                    conv.get_memo(`interface.l2tp.tunnel`)[pair] = ifname;
                }

                conv.add(`interface.${ifname}.${af}.source`, tokens[3]);
                conv.add(`interface.${ifname}.${af}.destination`, tokens[4]);
            }
        },

        'tunnel-end-address': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            conv.add(`interface.${ifname}.ipv4.address`, tokens[3]);
        },

        // interface <ipsec> tx-tos-set { <tos> | copy | system-default }
        'tx-tos-set': tokens => `interface.${conv.ifmap(tokens[1])}.tx-tos-set: ${tokens[3]}`,

        // interface <ipsec> unnumbered [on <leased-interface>]
        'unnumbered': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            var lease;
            if (tokens[3] == 'on') {
                lease = conv.ifmap(tokens[4]);
            } else {
                lease = conv.ifmap('lan0');
            }
            conv.add(`interface.${ifname}.ipv4.address`, lease);
        },

        'user-max-session': (conv, tokens) => {
            const ifname = conv.ifmap(tokens[1]);
            if (tokens[3] != 'unlimit') {
                conv.add(`interface.${ifname}.user-max-session`, tokens[3]);
            }
        },
    },
};

Converter.defer((conv) => {
    if (!conv.missing('interface pppac max-session unlimit', true)) {
        conv.get_memo('interface.pppac.max-session').forEach((num, ifname) => {
            if (num == 'default') {
                conv.add(`interface.${ifname}.max-session`, 'none');
            }
        });
    }
});

function ike_peer(conv, prefix, peer, if_prefix) {
    const prefix_ike = if_prefix ? `${prefix}.ike` : prefix;
    const prefix_proposal = if_prefix ? `${prefix}.ike.proposal.phase1` : `${prefix}.proposal`;

    conv.param2recipe(peer, 'dpd', `${prefix_ike}.dpd`);
    conv.param2recipe(peer, 'esp-fragment-size', `${prefix}.esp-fragment-size`);
    conv.param2recipe(peer, 'nonce-size', `${prefix}.nonce-size`);
    conv.param2recipe(peer, 'prefer-new-phase1', `${prefix}.prefer-new-phase1`);
    conv.param2recipe(peer, 'responder-only', `${prefix}.responder-only`, on2enable);
    conv.param2recipe(peer, 'variable-size-key-exchange-payload', `${prefix}.variable-size-key-exchange-payload`);

    if (!if_prefix) {
        conv.param2recipe(peer, 'address', `${prefix}.address`);
        conv.param2recipe(peer, 'exchange-mode', `${prefix_ike}.exchange-mode`);
    }

    // check-level はデフォルト値が strict -> obey に変更され、
    // かつ seil6 では設定不可。
    if (conv.missing('ike peer add ... check-level', true)) {
        if (peer['check-level'] && peer['check-level'] != 'obey') {
            conv.warning('check-level は obey のみサポートしています。');
        }
    } else {
        conv.add(`${prefix_ike}.check-level`, peer['check-level'] || 'strict');
    }

    if (peer['initial-contact'] == 'disable' &&
        conv.missing('ike peer add ... initial-contact disable')) {
            // just report an error.
    } else {
        conv.param2recipe(peer, 'initial-contact', `${prefix_ike}.initial-contact`);
    }

    // nat-traversal はデフォルト値が disable -> enable に変更され、
    // かつ seil6 と、interface.ipsecN には disable が書けない。
    if (conv.missing('ike peer add ... nat-traversal disable', true) || if_prefix) {
        if (peer['nat-traversal'] == 'disable') {
            conv.notsupported('ike peer add ... nat-traversal disable');
        } else if (peer['nat-traversal']) {
            conv.add(`${prefix}.nat-traversal`, peer['nat-traversal']);
        }
    } else {
        conv.add(`${prefix}.nat-traversal`, peer['nat-traversal'] || 'disable');
    }

    const ikep_name = peer['proposals'];
    const ikep = conv.get_params('ike.proposal')[ikep_name];
    if (ikep) {
        const k1 = `${prefix}.proposal`;
        (ikep['encryption'] || '').split(',').conv_aes().forEach(alg => {
            const ke = conv.get_index(`${prefix_proposal}.encryption`);
            conv.add(`${ke}.algorithm`, alg);
        });
        (ikep['hash'] || '').split(',').forEach(alg => {
            const ke = conv.get_index(`${prefix_proposal}.hash`);
            conv.add(`${ke}.algorithm`, alg);
        });
        conv.param2recipe(ikep, 'dh-group', `${prefix_proposal}.dh-group`);

        // IKE phase1 lifetime のデフォルト値は 28800 → 86400 に変更されている。
        conv.add(`${prefix_proposal}.lifetime`, ikep['lifetime-of-time'] || '8h') ;
    }

    const my_id = peer['my-identifier'];
    if (my_id) {
        if (my_id == 'address') {
            conv.add(`${prefix_ike}.my-identifier.type`, 'address');
        } else {
            conv.add(`${prefix_ike}.my-identifier.type`, my_id[0]);
            conv.add(`${prefix_ike}.my-identifier.${my_id[0]}`, my_id[1]);
        }
    }

    const peer_id = peer['peers-identifier'];
    if (peer_id) {
        if (peer_id == 'address') {
            conv.add(`${prefix_ike}.peers-identifier.type`, 'address');
        } else {
            conv.add(`${prefix_ike}.peers-identifier.type`, peer_id[0]);
            conv.add(`${prefix_ike}.peers-identifier.${peer_id[0]}`, peer_id[1]);
        }
    }

    var psk_id;
    if (peer_id == null || peer_id == 'address') {
        psk_id = peer['address'];
    } else {
        psk_id = peer_id[1];
    }
    const psk = conv.get_memo('ike.preshared-key')[psk_id];
    if (psk) {
        conv.add(`${prefix}.preshared-key`, psk);
    } else {
        conv.error('${psk_id} に対する preshared-key がありません。');
    }
}

Converter.rules['ipsec'] = {
    // https://www.seil.jp/doc/index.html#fn/ipsec/cmd/ipsec_anonymous-l2tp-transport.html
    'anonymous-l2tp-transport': {
        'enable': (conv, tokens) => {
            conv.note.anonymous_l2tp_transport.enable = true;
        },
        'preshared-key': (conv, tokens) => {
            conv.note.anonymous_l2tp_transport.preshared_key = tokens[3];
        },
    },

    'security-association': {
        // https://www.seil.jp/doc/index.html#fn/ipsec/cmd/ipsec_security-association.html
        'add': (conv, tokens) => {
            const sa_name = tokens[3];
            if (tokens[4] == 'tunnel-interface') {
                // ルーティングベース IPsec
                // ipsec security-association add <name> tunnel-interface <IPsec>
                //     ike <SAP_name> ah {enable|disable} esp {enable|disable}
                //     [ipv6 {pass|block}]
                //     [proxy-id-local {<IPaddress/prefixlen>|any}]
                //     [proxy-id-remote {<IPaddress/prefixlen>|any}]
                //     [proxy-id-protocol {<protocol>|any}]
                const ifname = tokens[5];
                const params = conv.read_params(null, tokens, 3, {
                    'tunnel-interface': true,
                    'ike': true,
                    'ah': true,
                    'esp': true,
                    'ipv6': true,
                    'proxy-id-local': true,
                    'proxy-id-remote': true,
                    'proxy-id-protocol': `interface.${ifname}.ike.proposal.phase2.proxy-id.protocol`,
                });

                if (conv.missing('ipsec security-association add ... ipv6', true)) {
                    if (params['ipv6'] == null) {
                        conv.warning(`${conv.devname} では常に "ipv6 block" 相当の動作になります。`);
                    } else if (params['ipv6'] == 'pass') {
                        conv.notsupported('ipv6 pass');
                    } // 'block' は seil6 のデフォルト動作なので何も出さない。
                } else {
                    if (params['ipv6'] == 'block') {
                        conv.add(`interface.${ifname}.ipv6.forward`, 'block');
                    } else {
                        conv.add(`interface.${ifname}.ipv6.forward`, 'pass');
                    }
                }

                // ipsec security-association proposal ...
                const kphase2 = `interface.${ifname}.ike.proposal.phase2`;
                const sap = conv.get_params('ipsec.security-association.proposal')[params['ike']];
                sap['authentication-algorithm'].split(',').forEach(alg => {
                    const ka = conv.get_index(`${kphase2}.authentication`);
                    conv.add(`${ka}.algorithm`, alg);
                });
                sap['encryption-algorithm'].split(',').conv_aes().forEach(alg => {
                    if (alg == 'blowfish' || alg == 'cast128' || alg == 'null') {
                        conv.notsupported(`ipsec proposal encryption-algorithm ${alg}`);
                    }
                    const ka = conv.get_index(`${kphase2}.encryption`);
                    conv.add(`${ka}.algorithm`, alg);
                });
                const pfs_group = sap['pfs-group'];
                if (pfs_group) {
                    if (pfs_group == 'none') {
                        // do nothing
                    } else if (pfs_group == 'modp768') {
                        conv.notsupported(`dh-group ${pfs_group}`);
                    } else {
                        conv.add(`${kphase2}.pfs-group`, pfs_group);
                    }
                }
                const lifetime = sap['lifetime-of-time'];
                if (lifetime) {
                    conv.add(`${kphase2}.lifetime-of-time`, lifetime);
                }

                // ike preshared-key & peer
                const dst = conv.get_memo(`interface.${ifname}.tunnel.destination`);
                const peer = conv.get_memo(`ike.peer.address.${dst}`);
                if (peer) {
                    ike_peer(conv, `interface.${ifname}`, peer, true);
                }

                const proxy_id_local = params['proxy-id-local'];
                if (proxy_id_local) {
                    if (proxy_id_local.is_ipv4_address()) {
                        conv.add(`interface.${ifname}.ike.proposal.phase2.proxy-id.ipv4.local`, proxy_id_local);
                    } else {
                        conv.add(`interface.${ifname}.ike.proposal.phase2.proxy-id.ipv6.local`, proxy_id_local);
                    }
                }

                const proxy_id_remote = params['proxy-id-remote'];
                if (proxy_id_remote) {
                    if (proxy_id_remote.is_ipv4_address()) {
                        conv.add(`interface.${ifname}.ike.proposal.phase2.proxy-id.ipv4.remote`, proxy_id_remote);
                    } else {
                        conv.add(`interface.${ifname}.ike.proposal.phase2.proxy-id.ipv6.remote`, proxy_id_remote);
                    }
                }
            } else {
                // ipsec security-association add <name> { tunnel | transport }
                //     { <start_IPaddress> <end_IPaddress> |
                //       <start_Interface> <end_IPaddress> | dynamic | auto }
                //     ike <SAP_name> ah { enable | disable }
                //                    esp { enable | disable }
                const params = {};
                const sa_idx = conv.get_named_index('sa');
                const k1 = `ipsec.security-association.${sa_idx}`;

                params['idx'] = sa_idx;

                var idx;
                if (tokens[4] == 'tunnel') {
                    // tunnel モード IPsec
                    idx = 5;
                    switch (tokens[5]) {
                        case 'dynamic':
                            params['address-type'] = 'dynamic';
                            idx += 1;
                            break;
                        case 'auto':
                            conv.notsupported('security-association auto');
                            break;
                        default:
                            params['address-type'] = 'static';
                            params['src'] = tokens[5];
                            params['dst'] = tokens[6];
                            const src = conv.ifmap(tokens[5]);
                            conv.add(`${k1}.local-address`, src);
                            conv.add(`${k1}.remote-address`, tokens[6]);
                            idx += 2;
                            break;
                    }
                    conv.add(`${k1}.address-type`, params['address-type']);
                } else if (tokens[4] == 'transport') {
                    // X4 では transport モード IPsec は L2TPv3 でしか使えない。
                    const src = tokens[5];
                    const dst = tokens[6];
                    const l2tpif = conv.get_memo('interface.l2tp.tunnel')[`${src}->${dst}`];
                    if (l2tpif == null) {
                        conv.notsupported(`ipsec security-association mode: ${tokens[4]}`);
                        return;
                    }
                    params['src'] = src;
                    params['dst'] = dst;
                    idx = 7;
                }

                if (tokens[idx] != 'ike') {
                    conv.notsupported('manual-key ipsec');
                    return;
                }
                params['ike'] = tokens[idx + 1];

                if (tokens[idx + 2] == 'ah') {  // "ah disable" は表示されないため enable に決まっている。
                    conv.notsupported('IPsec AH');
                    return;
                }
                // IKE 利用の場合は ESP は必ず enable なのでチェックしなくて良い。

                conv.set_memo(`ipsec.security-association.${sa_name}`, params);
            }
        },

        // ipsec security-association proposal add <name> ...
        //     authentication-algorithm { hmac-md5 | hmac-sha1 | hmac-sha256 | hmac-sha384 | hmac-sha512 },...
        //     encryption-algorithm { 3des | des | blowfish | cast128 | aes | aes128 | aes192 | aes256, null },...
        //     lifetime-of-time { <time> | system-default }]
        //     [pfs-group { modp768 | modp1024 | modp1536 | modp2048 | modp3072 | modp4096 | modp6144 | modp8192 | none }]
        'proposal': (conv, tokens) => {
            conv.read_params('ipsec.security-association.proposal', tokens, 4, {
                'authentication-algorithm': true,
                'encryption-algorithm': true,
                'lifetime-of-time': true,
                'pfs-group': true,
            });
        }
    },

    // ipsec security-policy add <name> security-association <SA_name>
    //     src { <IPaddress>[/<prefixlen>] | <interface> | any}
    //     dst { <IPaddress>[/<prefixlen>] | any }
    //     [srcport { <port> | any }] [dstport { <port> | any }] [protocol <protocol>]
    //     [enable | disable]
    'security-policy': (conv, tokens) => {
        const k1 = conv.get_index('ipsec.security-policy');
        const params = conv.read_params('ipsec.security-policy', tokens, 3, {
            'security-association': true,
            'src': true,
            'dst': true,
            'srcport': true,
            'dstport': true,
            'protocol': true,
            'enable': 0,
            'disable': 'notsupported'
        });
        const sa_name = params['security-association'];
        const sa = conv.get_memo(`ipsec.security-association.${sa_name}`);
        if (sa == null) {
            conv.badconfig(`ipsec security-association ${sa_name} is not properly configured`);
            return;
        }

        const sap_name = sa['ike'];

        const sap = conv.get_params('ipsec.security-association.proposal')[sap_name];

        // L2TPv3/IPsec 設定は特別扱い。
        const srcaddr = params['src'].replace(/\/32/, '');
        const dstaddr = params['dst'].replace(/\/32/, '');
        const srcdst = `${srcaddr}->${dstaddr}`;
        const l2tpif = conv.get_memo('interface.l2tp.tunnel')[srcdst];
        if (params['protocol'] == '115' && l2tpif &&
            sa['src'] == srcaddr && sa['dst'] == dstaddr) {
            const psk = conv.get_memo('ike.preshared-key')[dstaddr];
            if (psk) {
                const k2 = `interface.${l2tpif}.ike.proposal`;
                conv.add(`interface.${l2tpif}.ipsec-preshared-key`, psk);

                // phase1 parameters
                const ikepeer = conv.get_memo(`ike.peer.address.${dstaddr}`);
                const ikep = conv.get_params('ike.proposal')[ikepeer['proposals']];
                ikep['encryption'].split(',').conv_aes().forEach(name => {
                    const ka = conv.get_index(`${k2}.phase1.encryption`);
                    conv.add(`${ka}.algorithm`, name);
                });
                ikep['hash'].split(',').forEach(name => {
                    const ka = conv.get_index(`${k2}.phase1.hash`);
                    conv.add(`${ka}.algorithm`, name);
                });
                conv.param2recipe(ikep, 'dh-group', `${k2}.phase1.dh-group`);
                conv.param2recipe(ikep, 'lifetime-of-time', `${k2}.phase1.lifetime`);

                // phase2 parameters
                sap['authentication-algorithm'].split(',').forEach(name => {
                    const ka = conv.get_index(`${k2}.phase2.authentication`);
                    conv.add(`${ka}.algorithm`, name);
                });
                sap['encryption-algorithm'].split(',').conv_aes().forEach(name => {
                    const ka = conv.get_index(`${k2}.phase2.encryption`);
                    conv.add(`${ka}.algorithm`, name);
                });
                conv.param2recipe(sap, 'lifetime-of-time', `${k2}.phase2.lifetime-of-time`);
                conv.param2recipe(sap, 'pfs-group', `${k2}.phase2.pfs-group`);
            }
            const ikepeer = conv.get_memo(`ike.peer.address.${dstaddr}`);
            if (ikepeer) {
                // 注意: SEIL の nat-traversal はデフォルトで disable だが X4 の ipsec-nat-traversal は
                // デフォルトで enable。また、X4 には ipsec-nat-traversal: disable の設定が無い。
                // よって、
                //    nat-traversal enable  -> ipsec-nat-traversal: enable
                //    nat-traversal force   -> ipsec-nat-traversal: force
                //    nat-traversal disable -> 'deprecated'
                //    (none)                -> (none)
                //  とする。旧 SEIL で nat-traversal を設定されていないコンフィグは X4 には変換できないため
                //  正しくは 'deprecated' 警告を出すべきとも考えられるが、変換ログが見にくくなるためやめておく。
                var natt = ikepeer['nat-traversal'];
                if (natt == 'enable') {
                    conv.add(`interface.${l2tpif}.ipsec-nat-traversal`, 'enable');
                } else if (natt == 'force') {
                    conv.add(`interface.${l2tpif}.ipsec-nat-traversal`, 'force');
                } else if (natt == 'disable') {
                    conv.deprecated('ike nat-traversal disable');
                }
            }
            return;
        }

        //
        // ipsec.security-asociation
        //
        conv.add(`${k1}.security-association`, sa['idx']);

        const kprop = `${k1}.ike.proposal`;
        sap['authentication-algorithm'].split(',').forEach(alg => {
            const ka = conv.get_index(`${kprop}.authentication`);
            conv.add(`${ka}.algorithm`, alg);
        });
        sap['encryption-algorithm'].split(',').conv_aes().forEach(alg => {
            if (alg == 'blowfish' || alg == 'cast128' || alg == 'null') {
                conv.notsupported(`ipsec proposal encryption-algorithm ${alg}`);
            }
            const ka = conv.get_index(`${kprop}.encryption`);
            conv.add(`${ka}.algorithm`, alg);
        });
        if (sap['lifetime-of-time']) {
            conv.add(`${kprop}.lifetime-of-time`, sap['lifetime-of-time']);
        }
        const pfs_group = sap['pfs-group'];
        if (pfs_group) {
            if (pfs_group == 'modp768') {
                conv.notsupported(`dh-group ${pfs_group}`);
            } else {
                conv.add(`${kprop}.pfs-group`, sap['pfs-group']);
            }
        }

        //
        // ipsec.security-policy
        //
        conv.param2recipe(params, 'src', `${k1}.source.address`,
            ifname => conv.ifmap(ifname));
        conv.param2recipe(params, 'dst', `${k1}.destination.address`);
        conv.param2recipe(params, 'srcport', `${k1}.source.port`);
        conv.param2recipe(params, 'dstport', `${k1}.destination.port`);
        conv.param2recipe(params, 'protocol', `${k1}.protocol`);

        //
        // ike peer add ...
        //
        if (sa['address-type'] == 'static') {
            const peer = conv.get_memo(`ike.peer.address.${sa['dst']}`);
            if (peer) {
                ike_peer(conv, conv.get_index('ike.peer'), peer, false);
            }
        } else if (sa['address-type'] == 'dynamic') {
            (conv.get_memo('ike.peer.dynamic') || []).forEach(peer => {
                ike_peer(conv, conv.get_index('ike.peer'), peer, false);
            });
        }
    },
};

Converter.defer((conv) => {
    const psk = conv.note.anonymous_l2tp_transport.preshared_key;
    if (psk && conv.note.anonymous_l2tp_transport.enable) {
        conv.note.anonymous_l2tp_transport.ifnames.forEach(ifname => {
            conv.add(`interface.${ifname}.l2tp.ipsec.preshared-key`, psk);
        });
    } else {
        conv.note.anonymous_l2tp_transport.ifnames.forEach(ifname => {
            conv.add(`interface.${ifname}.l2tp.ipsec.requirement`, 'optional');
        });
    }
});

Converter.rules['l2tp'] = {
    'add': (conv, tokens) => {
        conv.read_params('l2tp', tokens, 2, {
            'hostname': true,
            'router-id': true,
            'password': true,
            'cookie': true,
            'retry': true,
            'hello-interval': true,
            'compatibility': 'notsupported'
        });
    },
    'hostname': (conv, tokens) => {
        conv.set_memo('l2tp.hostname', tokens[2]);
    },
    'router-id': (conv, tokens) => {
        conv.set_memo('l2tp.router-id', tokens[2]);
    }
};

Converter.rules['macfilter'] = {
    // https://www.seil.jp/doc/index.html#fn/macfilter/cmd/macfilter.html#add
    'add': (conv, tokens) => {
        // macfilter add <name> [action { block | pass }] [on { <lan> | <vlan> | bridge }]
        //     src { any | <MACaddress> | <URL> interval <time> }
        //     [logging { on | off }]
        //     [block-dhcp { on | off }]
        const params = conv.read_params('macfilter', tokens, 2, {
            'action': true,
            'logging': true,
            'on': true,
            'src': true,
            'interval': true,
            'block-dhcp': 'notsupported'
        });
        var k1;
        if (params['interval']) {  // URL 指定の場合は必ず interval パラメタがある。
            k1 = conv.get_index('macfilter.entry-list');
            conv.param2recipe(params, 'src', `${k1}.url`);
            conv.param2recipe(params, 'interval', `${k1}.update-interval`);
        } else {
            k1 = conv.get_index('macfilter.entry');
            conv.param2recipe(params, 'src', `${k1}.address`);
        }
        conv.param2recipe(params, 'on', `${k1}.interface`, name => conv.ifmap(name));
        conv.param2recipe(params, 'action', `${k1}.action`);
        conv.param2recipe(params, 'logging', `${k1}.logging`);
    }
};

function monitor_source_group(conv, group_name) {
    const l = conv.get_memo(`monitor.source-group.${group_name}`);
    if (l == null) { return; }
    const source_map = conv.get_params('monitor.source');
    l.forEach(source_name => {
        const params = source_map[source_name];
        const type = params['type'];
        const k1 = (type == 'boot-information' || type == 'usb-port')
            ? `monitor.${type}`
            : conv.get_index(`monitor.${type}`);

        conv.param2recipe(params, 'description', `${k1}.description`);
        conv.param2recipe(params, 'down-count', `${k1}.down-count`);
        conv.param2recipe(params, 'target-host', `${k1}.address`);
        conv.param2recipe(params, 'interface', `${k1}.interface`, ifname => conv.ifmap(ifname));
        conv.param2recipe(params, 'source-address', `${k1}.source-address`);
        conv.param2recipe(params, 'watch-interval', `${k1}.watch-interval`);

        if (type == 'boot-information' && params['trigger'] != 'all') {
            params['trigger'] = 'unknown';
        }
        params['trigger'].split(',').forEach(t => {
            const k2 = conv.get_index(`${k1}.trigger`);
            conv.add(`${k2}.event`, t);
        });
    });
}

function monitor_server_group(conv, group_name) {
    const l = conv.get_memo(`notification-server-group-name.${group_name}`);
    if (l == null) { return; }

    l.forEach(params => {
        const k1 = conv.get_index('monitor.notification.snmp-trap');
        conv.param2recipe(params, 'authentication-password', `${k1}.authentication-password`);
        conv.param2recipe(params, 'destination-address', `${k1}.address`);
        conv.param2recipe(params, 'engine-id', `${k1}.engine-id`);
        conv.param2recipe(params, 'port', `${k1}.port`);
        conv.param2recipe(params, 'privacy-password', `${k1}.privacy-password`);
        conv.param2recipe(params, 'user-name', `${k1}.user-name`);
        if (params['source-address'] != 'auto') {
            conv.param2recipe(params, 'source-address', `${k1}.source-address`);
        }
    });

    conv.set_memo(`notification-server-group-name.${group_name}`, null);
}

Converter.rules['monitor'] = {
    'binding': {
        'add': {
            '*': {
                // monitor binding add <binding_name>
                //  source-group <source_group_name>
                //  [notification-server-group <notification_server_group_name>]
                'source-group': (conv, tokens) => {
                    const source = tokens[5];
                    if (tokens[6] != 'notification-server-group') { return; };
                    const server = tokens[7];
                    monitor_source_group(conv, source);
                    monitor_server_group(conv, server);
                }
            }
        }
    },
    'disable': [],
    'enable': 'monitor.service: enable',

    // monitor notification-server-group <notification_server_group_name>
    //  server add <notification_server_name>
    //   protocol snmp-trap-v3 user-name <user_name>
    //    destination-address <destination_address>
    //     ...
    'notification-server-group': {
        '*': {
            'server': {
                'add': (conv, tokens) => {
                    if (tokens[7] != 'snmp-trap-v3') {
                        conv.notsupported(`protocol ${tokens[7]}`);
                        return;
                    }
                    const group_name = tokens[2];
                    const params = conv.read_params('monitor.notification-server', tokens, 5, {
                        'authentication-method': true,
                        'authentication-password': true,
                        'destination-address': true,
                        'engine-id': true,
                        'port': true,
                        'privacy-algorithm': true,
                        'privacy-password': true,
                        'protocol': true,
                        'security': true,
                        'send-count': true,
                        'send-interval': true,
                        'source-address': true,
                        'user-name': true,
                    });
                    (conv.get_memo(`notification-server-group-name.${group_name}`) || []).push(params);
                }
            }
        }
    },
    'notification-server-group-name': {
        // monitor notification-server-group-name add <name>
        'add': (conv, tokens) => {
            const name = tokens[3];
            conv.set_memo(`notification-server-group-name.${name}`, []);
        }
    },
    // monitor source add <name> type ...
    'source': {
        'add': {
            '*': {
                'type': (conv, tokens) => {
                    const type = tokens[5];
                    const rules = {
                        'event': true,
                        'description': true,
                        'down-count': true,
                        'interface': true,
                        'source-address': true,
                        'target-host': true,
                        'trigger': true,
                        'type': true,
                        'watch-interval': true
                    };
                    if (type != 'ping') {
                        rules['watch-interval'] = 'notsupported';
                    }
                    conv.read_params('monitor.source', tokens, 3, rules);
                }
            }
        }
    },
    'source-group': {
        // monitor source-group <source_group_name> source add <name>
        '*': {
            'source': {
                'add': (conv, tokens) => {
                    const group_name = tokens[2];
                    const source_name = tokens[5];
                    conv.get_memo(`monitor.source-group.${group_name}`).push(source_name);
                }
            }
        }
    },
    'source-group-name': {
        // monitor source-group-name add <name>
        'add': (conv, tokens) => {
            const name = tokens[3];
            conv.set_memo(`monitor.source-group.${name}`, []);
        }
    },
};

Converter.rules['nat'] = {
    'bypass': {
        'add': (conv, tokens) => {
            // nat bypass add <private_IPv4address> <global_IPv4address> [interface <interface>]
            const k1 = conv.get_index('nat.ipv4.bypass');
            conv.add(`${k1}.private`, tokens[3]);
            conv.add(`${k1}.global`, tokens[4]);
            conv.add(`${k1}.interface`, conv.natifname(tokens[6]));
        },
    },

    'logging': {
        'off': [],
        '*': 'notsupported',
    },

    'dynamic': {
        'add': {
            // https://www.seil.jp/doc/index.html#fn/nat/cmd/nat_dynamic.html#add_global
            'global': (conv, tokens) => {
                // nat dynamic add global <global_IPaddress> [interface <interface>]
                const ifname = conv.natifname(tokens[6]);
                const m = `nat.dynamic.global.${ifname}`;
                const globals = conv.get_memo(m);
                if (globals) {
                    globals.push(tokens[4]);
                } else {
                    conv.set_memo(m, [ tokens[4] ]);
                }
            },

            'private': (conv, tokens) => {
                // nat dynamic add private <private_IPaddress> [interface <interface>]
                const ifname = conv.natifname(tokens[6]);
                const m = `nat.dynamic.global.${ifname}`;
                const k1 = conv.get_index('nat.ipv4.dnat');
                conv.get_memo(m).forEach(g => {
                    const k2 = conv.get_index(`${k1}.global`);
                    conv.add(`${k2}.address`, g);
                });
                conv.add(`${k1}.private.100.address: ${tokens[4]}`);
            },
        },
    },

    // https://www.seil.jp/doc/index.html#fn/nat/cmd/nat_napt.html
    // https://www.seil.jp/sx4/doc/sa/nat/config/nat.ipv4.napt.html
    'napt': {
        'add': {
            'global': (conv, tokens) => {
                // nat napt add global <addr> [interface <ifname>]
                conv.note.napt.global = {
                    addr: tokens[4],
                    conv: conv,
                    ifname: conv.natifname(tokens[6])
                };
                conv.defer2(conv => {
                    const napt = conv.note.napt;
                    const napts = napt.ifnames.get(napt.global.ifname);
                    if (napts == undefined) {
                        return;
                    } else if (napt.ifnames.size == 1) {
                        conv.add(`nat.ipv4.napt.global`, napt.global.addr);
                    } else {
                        napts.forEach(pair => {
                            const [prefix, conv] = pair;
                            if (prefix.startsWith('nat.ipv4.napt')) {
                                conv.add(`${prefix}.global`, napt.global.addr);
                            } else {
                                conv.add(`${prefix}.listen.address`, napt.global.addr);
                            }
                        });
                    }
                });
            },

            'private': (conv, tokens) => {
                // nat napt add private <addrs> [interface <ifname>]
                const ifname = conv.natifname(tokens[6]);
                const k1 = conv.get_index('nat.ipv4.napt');
                conv.add(`${k1}.private`, tokens[4]);
                conv.add(`${k1}.interface`, ifname);

                conv.note.napt.add(ifname, k1, conv);
            },
        },
    },

    'option': {
        'port-assignment': tokens => `nat.ipv4.option.port-assignment: ${tokens[3]}`,
    },

    'proxy': {
        'sip': {
            'add': {
                'port': (conv, tokens) => {
                    const k = conv.get_index('nat.proxy.sip');
                    conv.add(`${k}.protocol: ${tokens[7]}`);
                    conv.add(`${k}.port: ${tokens[5]}`);
                }
            }
        },
    },

    'reflect': {
        'add': {
            'interface': (conv, tokens) => {
                // nat reflect add interface <interface>
                const k1 = conv.get_index('nat.ipv4.reflect')
                conv.add(`${k1}.interface: ${conv.ifmap(tokens[4])}`);
            }
        }
    },

    'session': {
        // nat session restricted-per-ip { <max> | system-default }
        'restricted-per-ip': tokens => `nat.ipv4.option.limit.session-per-ip: ${tokens[3]}`,

        // nat session restricted-per-private-ip { <max> | system-default }
        'restricted-per-private-ip': tokens => `nat.ipv4.option.limit.session-per-private-ip: ${tokens[3]}`
    },

    // https://www.seil.jp/doc/index.html#fn/nat/cmd/nat_static.html#add
    'static': {
        'add': (conv, tokens) => {
            // nat static add <private_IPaddress> <global_IPaddress> [interface <interface>]
            const k1 = conv.get_index('nat.ipv4.snat');
            conv.add(`${k1}.private`, tokens[3]);
            conv.add(`${k1}.global`, tokens[4]);
            conv.add(`${k1}.interface`, conv.natifname(tokens[6]));
        },
    },

    // https://www.seil.jp/doc/index.html#fn/nat/cmd/nat_snapt.html
    'snapt': (conv, tokens) => {
        // nat snapt add
        //     protocol {tcp|udp|tcpudp}
        //     listen <listen_port>
        //     forward <IPv4address> <forward_port>
        //     [interface { <interface> | <interface*> }] [enable | disable]
        // nat snapt add
        //     protocol <protocol>
        //     forward <IPv4address>
        //     [interface { <interface> | <interface*> }] [enable | disable]
        // nat snapt add
        //     default <IPv4address>
        //     [interface { <interface> | <interface*> }]
        const fport_param = tokens.includes("listen") ? 2 : true;
        const params = conv.read_params(null, tokens, 2, {
            'protocol': true,
            'listen': true,
            'forward': fport_param,
            'interface': true,
            'default': true,
            'enable': 0,
            'disable': 0
        });
        if (params['disable']) {
            return;
        }

        const ifname = conv.natifname(params['interface']);
        if (params['default']) {
            // nat snapt add default は TCP/UDP のすべてのポートを指定した
            // 内部ホストに転送する snapt の最後のエントリに変換する。
            conv.defer(conv => {
                const k1 = conv.get_index('nat.ipv4.snapt');
                conv.add(`${k1}.protocol`, 'tcpudp');
                conv.add(`${k1}.listen.port`, '1-65535');
                conv.add(`${k1}.forward.address`,tokens[4]);
                conv.add(`${k1}.forward.port`, '1-65535');
                conv.add(`${k1}.interface`, ifname);

                conv.note.napt.add(ifname, k1, conv);
            });
            return;
        }
        const k1 = conv.get_index('nat.ipv4.snapt');
        conv.param2recipe(params, 'protocol', `${k1}.protocol`);
        conv.param2recipe(params, 'listen', `${k1}.listen.port`);
        if (fport_param == 2) {
            conv.add(`${k1}.forward.address`, params['forward'][0]);
            conv.add(`${k1}.forward.port`, params['forward'][1]);
        } else {
            conv.param2recipe(params, 'forward', `${k1}.forward.address`);
        }
        conv.add(`${k1}.interface`, ifname);
        conv.note.napt.add(ifname, k1, conv);
    },

    // https://www.seil.jp/doc/index.html#fn/nat/cmd/nat_timeout.html
    'timeout': {
        '*': tokens => `nat.ipv4.timeout: ${tokens[2]}`,

        'dynamic': 'deprecated',

        // nat timeout protocol { tcp-synonly | tcp-established | udp | icmp } { <time> | system-default }
        'protocol': tokens => `nat.ipv4.timeout.${tokens[3]}: ${tokens[4]}`,
    },

    // https://www.seil.jp/doc/index.html#fn/nat/cmd/nat_upnp.html
    'upnp': {
        'interface': (conv, tokens) => {
            conv.add('upnp.interface', conv.ifmap(tokens[3]));
        },
        'on': (conv, tokens) => {
            conv.add('upnp.service', 'enable');
            if (! conv.missing('upnp.listen.[].interface', true)) {
                conv.add('upnp.listen.0.interface', conv.ifmap('lan0'));
            }
        },
        'off': 'upnp.service: disable',
        'timeout': (conv, tokens) => {
            if (tokens[3] == 'type') {
                // nat upnp timeout type { normal | arp }
                conv.add('upnp.timeout-type', tokens[4]);
            } else {
                // nat upnp timeout { <time> | none }
                conv.add('upnp.timeout', tokens[3]);
            }
        }
    },
};

Converter.rules['nat6'] = {
    'add': (conv, tokens) => {
        // nat6 add <name> type {ngn|transparent} internal <prefix/prefixlen>
        //     external <prefix/prefixlen> interface <interface>
        //     [ndproxy { on | off | system-default }]
        if (conv.missing('nat6')) { return; }
        const k1 = conv.get_index('nat.ipv6');
        conv.read_params(null, tokens, 2, {
            'type': `${k1}.type`,
            'internal': `${k1}.internal`,
            'external': `${k1}.external`,
            'interface': {
                key: `${k1}.interface`,
                fun: val => conv.ifmap(val)
            },
            'ndproxy': {
                key: `${k1}.ndproxy`,
                fun: on2enable
            }
        });
    }
};

Converter.rules['ntp'] = {
    // https://www.seil.jp/doc/index.html#fn/ntp/cmd/ntp.html
    // https://www.seil.jp/sx4/doc/sa/ntp/config/ntp.client.html
    'disable': 'ntp.service: disable',

    'enable': (conv, tokens) => {
        conv.add('ntp.service', 'enable');
        conv.defer((conv) => {
            if (conv.get_memo('ntp.mode') != 'client') {
                conv.add('ntp.server', 'enable');
            } else {
                conv.add('ntp.server', 'disable');
            }
        })
    },

    // ntp mode { client | server | system-default }
    'mode': (conv, tokens) => {
        conv.set_memo('ntp.mode', tokens[2]);
    },

    'peer': 'notsupported',

    // ntp server add {<IPaddress>|dhcp6 } [prefer {on|off}]
    'server': (conv, tokens) => {
        const k1 = conv.get_index('ntp.client');
        if (tokens[2] == 'add') {
            conv.add(`${k1}.address`, tokens[3]);
            if (tokens[4] == 'prefer') {
                conv.notsupported('ntp prefer parameter');
            }
        } else if (tokens[2].is_ipv4_address()) {
            // Compatibility Syntax: ntp server <IPv4address>
            conv.add(`${k1}.address`, tokens[2]);
        } else {
            conv.syntaxerror(`ntp server ${tokens[2]}`);
        }
    },
};

Converter.rules['option'] = {
    'ip': {
        'accept-redirect': (conv, tokens) => {
            if (tokens[3] != 'off') {
                conv.notsupported();
            }
        },
        'broadcast-icmp': (conv, tokens) => {
            if (tokens[3] != 'ignore') {
                conv.notsupported();
            }
        },
        'directed-broadcast': tokens => `option.ipv4.directed-broadcast.service: ${on2enable(tokens[3])}`,
        'fragment-requeueing': (conv, tokens) => {
            conv.set_memo('option.ipv4.fragment-requeueing.service',
                [ conv, on2enable(tokens[3]) ]);
        },
        'mask-reply': (conv, tokens) => {
            if (tokens[3] != 'off') {
                conv.notsupported();
            }
        },
        'monitor-linkstate': (conv, tokens) => {
            conv.set_memo('option.ipv4.monitor-linkstate.service',
                [ conv, on2enable(tokens[3]) ]);
        },
        'multipath-selection': (conv, tokens) => {
            if (conv.missing('option ip multipath-selection')) { return; }
            conv.add('option.ipv4.multipath-selection.service', on2enable(tokens[3]));
        },
        'redirects': (conv, tokens) => {
            conv.set_memo('option.ipv4.send-icmp-redirect.service',
                [ conv, on2enable(tokens[3]) ]);
        },
        'recursive-lookup': (conv, tokens) => {
            if (tokens[3] != 'off') {
                conv.notsupported();
            }
        },
        'unicast-rpf': (conv, tokens) => {
            if (tokens[3] != 'none') {
                conv.notsupported();
            }
        },
        'update-connected-route': tokens => `option.ipv4.update-connected-route.service: ${on2enable(tokens[3])}`,
    },

    'ipv6': {
        'avoid-path-mtu-discovery': 'deprecated',
        'fragment-requeueing': (conv, tokens) => {
            conv.set_memo('option.ipv6.fragment-requeueing.service',
                [conv, on2enable(tokens[3])]);
        },
        'monitor-linkstate': (conv, tokens) => {
            conv.set_memo('option.ipv6.monitor-linkstate.service',
                [conv, on2enable(tokens[3])]);
        },
        'redirects': (conv, tokens) => {
            conv.set_memo('option.ipv6.send-icmp-redirect.service',
                [conv, on2enable(tokens[3])]);
        },
        'router-advertisement': {
            'fast-switch': tokens => `option.ipv6.router-advertisement.fast-switch.service: ${on2enable(tokens[4])}`
        },
        'unicast-rpf': (conv, tokens) => {
            if (tokens[3] != 'none') {
                conv.notsupported();
            }
        },
        'update-connected-route': tokens => `option.ipv6.update-connected-route.service: ${on2enable(tokens[3])}`,
    },

    'statistics': 'notsupported',
};

function spec_changed_options(conv, feature, new_key, old_default_value, new_default_value) {
    const [old_conv, old_value] = conv.get_memo(new_key) || [null, null];
    if (!conv.missing(feature, true)) {
        conv.add(new_key, old_value || old_default_value);
    } else if (old_value && old_value != new_default_value) {
        old_conv.notsupported();
    }
}

Converter.defer((conv) => {
    spec_changed_options(conv, 'option ip fragment-requeueing off',
        'option.ipv4.fragment-requeueing.service', 'disable', 'enable');
    spec_changed_options(conv, 'option ip monitor-linkstate off',
        'option.ipv4.monitor-linkstate.service', 'disable', 'enable');
    spec_changed_options(conv, 'option ip redirects on',
        'option.ipv4.send-icmp-redirect.service', 'enable', 'disable');
    spec_changed_options(conv, 'option ipv6 fragment-requeueing off',
        'option.ipv6.fragment-requeueing.service', 'disable', 'enable');
    spec_changed_options(conv, 'option ipv6 monitor-linkstate off',
        'option.ipv6.monitor-linkstate.service', 'disable', 'enable');
    spec_changed_options(conv, 'option ipv6 redirects on',
        'option.ipv6.send-icmp-redirect.service', 'enable', 'disable');
});

Converter.rules['ppp'] = {
    'add': (conv, tokens) => {
        const params = conv.read_params('ppp', tokens, 2, {
            'ipcp': true,
            'ipv6cp': true,
            'keepalive': true,
            'ipcp-address': true,
            'ipcp-dns': true,
            'acname': 'notsupported',
            'servicename': 'notsupported',
            'authentication-method': true,
            'identifier': true,
            'passphrase': true,
            'tcp-mss': true,
            'tcp-mss6': true,
            'auto-connect': true,
            'idle-timer': true,
            'mppe': 'notsupported'
        });
    },
};

Converter.rules['pppac'] = {
    // https://www.seil.jp/doc/index.html#fn/pppac/cmd/pppac_ipcp-configuration.html
    'ipcp-configuration': {
        'add': (conv, tokens) => {
            conv.read_params('pppac.ipcp-configuration', tokens, 3, {
                'pool': true,
                'dns-use-forwarder': value => {
                    if (value == 'on') {
                        return new Error('notsupported');
                    } else {
                        return value;
                    }
                },
                'dns-primary': true,
                'dns-secondary': true,
                'wins-server-primary': true,
                'wins-server-secondary': true,
                'accept-user-address': true,
            });
        },
    },
    'option': {
        'session-limit': (conv, tokens) => {
            if (tokens[3] == 'off') {
                if (conv.missing('pppac option session-limit off')) {
                    return;
                }
            }
            conv.add('option.pppac.session-limit', on2enable(tokens[3]));
        },
    },
    'pool': {
        'add': (conv, tokens) => {
            conv.read_params('pppac.pool', tokens, 3, {
                'address': true,
                'type': true,
            });
        },
    },
    'protocol': {
        'l2tp': {
            'add': (conv, tokens) => {
                const params = conv.read_params('pppac.protocol', tokens, 4, {
                    'accept-dialin': true,
                    'accept-interface': true,
                    'authentication-method': true,
                    'authentication-timeout': true,
                    'mppe' :true,
                    'mppe-key-length': true,
                    'mppe-key-change': true,
                    'l2tp-keepalive-interval': true,
                    'l2tp-keepalive-timeout': true,
                    'lcp-keepalive': true,
                    'lcp-keepalive-interval': true,
                    'lcp-keepalive-retry-interval': true,
                    'lcp-keepalive-max-retries': true,
                    'tcp-mss-adjust': true,
                    'mru': true,
                    'idle-timer': true,
                });
                params['protocol'] = 'l2tp';
            },
            // pppac protocol l2tp require-ipsec { on | off | system-default }
            'require-ipsec': (conv, tokens) => {
                conv.set_memo('pppac.protocol.l2tp.require-ipsec', (tokens[4] == 'on'));
            }
        },
        'pppoe': 'notsupported',
        'pptp': 'notsupported',
        'sstp': {
            'add': (conv, tokens) => {
                const params = conv.read_params('pppac.protocol', tokens, 4, {
                    'accept-interface': true,
                    'authentication-method': true,
                    'authentication-timeout': 'notsupported',
                    'certificate': true,
                    'idle-timer': true,
                    'lcp-keepalive': true,
                    'lcp-keepalive-interval': true,
                    'lcp-keepalive-max-retries': true,
                    'lcp-keepalive-retry-interval': true,
                    'mru': true,
                    'sstp-keepalive-interval': true,
                    'sstp-keepalive-timeout': true,
                    'tcp-mss-adjust': true,
                });
                params['protocol'] = 'sstp';

                if ((params['authentication-method'] || '').split(',').includes('eap-radius')) {
                    conv.notsupported('authentication-method eap-radius');
                }
            },
        }
    }
};

Converter.rules['proxyarp'] = {
    // proxyarp add <name> interface <interface> address { <IPv4address> | <IPv4address_range> }
    //     [mac-address { <MACaddress> | auto | system-default }]
    'add': (conv, tokens) => {
        if (! conv.get_memo('proxyarp.enable')) {
            return;
        }
        const k1 = conv.get_index('proxyarp');
        conv.add(`${k1}.interface`, conv.ifmap(tokens[4]));
        conv.add(`${k1}.ipv4-address`, tokens[6]);
        if (tokens[7] == 'mac-address') {
            conv.add(`${k1}.mac-address`, tokens[8]);
        }
    },
    'disable': [],
    'enable': (conv, tokens) => {
        conv.set_memo('proxyarp.enable', true);
    },
};

Converter.rules['resolver'] = {
    // resolver address add { <IPaddress> | ipcp | ipcp-auto | dhcp | dhcp6 }
    'address': (conv, tokens) => {
        if (conv.get_memo('resolver.address').length == 0) {
            conv.defer(conv => {
                let addrs = conv.get_memo('resolver.address');
                if (conv.missing('resolver server-priority', true)) {
                    // on seil8
                    if (conv.get_memo('resolver.server-priority') != 'config-order') {
                        let i = addrs.findIndex(a => ['dhcp', 'dhcp6', 'ipcp', 'ipcp-auto'].includes(a));
                        if (i != -1) {
                            addrs.push(addrs[i]);
                            addrs.splice(i, 1);
                        }
                    }
                } else {
                    // on seil6
                    if (conv.get_memo('resolver.server-priority') == 'config-order') {
                        conv.add('resolver.server-priority', 'config-order');
                    }
                }
                addrs.forEach(addr => {
                    const k = conv.get_index('resolver');
                    conv.add(`${k}.address`, addr);
                });
            })
        }
        if (tokens[3] == 'ipcp-auto') {
            conv.get_memo('resolver.address').push('ipcp');
        } else {
            conv.get_memo('resolver.address').push(tokens[3]);
        }
    },
    'disable': 'resolver.service: disable',
    'domain': tokens => `resolver.domain: ${tokens[2]}`,
    'enable': 'resolver.service: enable',

    // resolver host-database add <hostname> address <IPaddress>[,<IPaddress>]...
    'host-database': (conv, tokens) => {
        tokens[5].split(",").forEach(addr => {
            const k1 = conv.get_index('resolver.host-database');
            conv.add(`${k1}.hostname`, tokens[3]);
            conv.add(`${k1}.address`, addr);
        });
    },

    'order': 'notsupported',

    // resolver server-priority { config-order | prefer-static | system-default }
    'server-priority': (conv, tokens) => {
        conv.set_memo('resolver.server-priority', tokens[2]);
    },
};

function route_filter_common(conv, prefix, name, af) {
    const rf = conv.get_params(`route-filter.${af}`)[name];
    if (rf == null) {
        return;
    }
    const k = conv.get_index(prefix);
    conv.param2recipe(rf, 'interface', `${k}.match.interface`, val => conv.ifmap(val));
    conv.param2recipe(rf, 'network', `${k}.match.prefix`, val => `${val}`);
    conv.param2recipe(rf, 'set-as-path-prepend', `${k}.set.as-path-prepend`,
        val => val.split(',').join(' '));
    conv.param2recipe(rf, 'set-metric', `${k}.set.metric`);
    conv.param2recipe(rf, 'set-metric-type', `${k}.set.metric-type`);
    conv.param2recipe(rf, 'set-weight', `${k}.set.weight`);
    if (rf['pass']) {
        conv.add(`${k}.action`, 'pass');
    }
    if (rf['block']) {
        conv.add(`${k}.action`, 'block');
    }
}

function route_filter(conv, prefix, name) {
    route_filter_common(conv, prefix, name, 'ipv4');
}

function route6_filter(conv, prefix, name) {
    route_filter_common(conv, prefix, name, 'ipv6');
}

Converter.rules['route'] = {
    // https://www.seil.jp/sx4/doc/sa/route/config/route.ipv4.html
    'add': (conv, tokens) => {
        // route add {<IPv4address>[/<prefixlen>]|default}
        //     {<gateway_IPv4address>|<interface>|dhcp|discard}
        //     [distance <distance>] [metric <metric>]
        //     [keepalive {on|off} [target <IPv4address>] [send-interval <interval>]
        //         [timeout <timeout>] [down-count <count>] [up-count <count>] [src <IPv4address>]]
        const k1 = conv.get_index('route.ipv4');
        conv.add(`${k1}.destination`, tokens[2]);
        conv.add(`${k1}.gateway`, tokens[3]);
        const params = conv.read_params(null, tokens, 3, {
            'distance': true,
            'metric': 'deprecated',
            'keepalive': true,
            'target': true,
            'send-interval': true,
            'timeout': true,
            'down-count': true,
            'up-count': true,
            'src': true,
        });
        conv.param2recipe(params, 'distance',      `${k1}.distance`);
        conv.param2recipe(params, 'keepalive',     `${k1}.keepalive.service`, on2enable);
        conv.param2recipe(params, 'target',        `${k1}.keepalive.target`);
        conv.param2recipe(params, 'send-interval', `${k1}.keepalive.send-interval`);
        conv.param2recipe(params, 'timeout',       `${k1}.keepalive.timeout`);
        conv.param2recipe(params, 'down-count',    `${k1}.keepalive.down-count`);
        conv.param2recipe(params, 'up-count',      `${k1}.keepalive.up-count`);
        conv.param2recipe(params, 'src',           `${k1}.keepalive.source.address`);
    },
    'dynamic': {
        'auth-key': (conv, tokens) => {
            // route dynamic auth-key add <name> type plain-text password <password>
            // route dynamic auth-key add <name> type md5 keyid <keyid> password <password>
            const m = `route.auth-key.${tokens[4]}`;
            conv.read_params('route.auth-key', tokens, 4, {
                'type': true,
                'keyid': true,
                'password': true,
            });
        },

        'bgp': {
            'disable': [],

            'enable': (conv, tokens) => {
                const asn = conv.get_memo('bgp.my-as-number');
                conv.add('bgp.my-as-number', asn);

                const rtr = conv.get_memo('bgp.router-id');
                conv.add('bgp.router-id', rtr);

                conv.set_memo('bgp.enable', true);
            },

            'my-as-number': (conv, tokens) => {
                // route dynamic bgp my-as-number <as-number>
                conv.set_memo('bgp.my-as-number', tokens[4]);
            },

            // route dynamic bgp neighbor add <neighbor_IPv4address> remote-as <as-number>
            //     [hold-timer <hold_time>] [weight <weight>]
            //     [in-route-filter <route-filter-name>[,<route-filter-name>...]]
            //     [out-route-filter <route-filter-name>[,<route-filter-name>...]]
            //     [authentication md5 <password>] [disable | enable]
            'neighbor': (conv, tokens) => {
                if (!conv.get_memo('bgp.enable')) { return; }
                if (tokens[tokens.length - 1] == 'disable') {
                    return;
                }
                const k1 = conv.get_index('bgp.neighbor');
                const params = conv.read_params(null, tokens, 5, {
                    'remote-as': `${k1}.remote-as`,
                    'hold-timer': `${k1}.hold-timer`,
                    'weight': `${k1}.weight`,
                    'authentication': 0,
                    'md5': `${k1}.authentication.password`,
                    'in-route-filter': true,
                    'out-route-filter': true,
                    'enable': 0,
                });
                conv.param2recipe(params, '*NAME*', `${k1}.address`);
                (params['in-route-filter'] || "").split(',').forEach(name => {
                    route_filter(conv, `${k1}.filter.in`, name);
                });
                (params['out-route-filter'] || "").split(',').forEach(name => {
                    route_filter(conv, `${k1}.filter.out`, name);
                });
            },

            'network': (conv, tokens) => {
                // route dynamic bgp network add <network_IPv4address/prefixlen>
                const k1 = conv.get_index('bgp.network');
                conv.add(`${k1}.prefix`, tokens[5]);
            },

            'router-id': (conv, tokens) => {
                // route dynamic bgp router-id <router-id>
                conv.set_memo('bgp.router-id', tokens[4]);
            },
        },

        // https://www.seil.jp/doc/index.html#fn/route/cmd/route_dynamic_ospf.html
        'ospf': {
            'administrative-distance': {
                // route dynamic ospf administrative-distance
                //     { external | inter-area | intra-area } { <number> | system-default }
                'external': tokens => `ospf.administrative-distance.external: ${tokens[5]}`,
                'inter-area': tokens => `ospf.administrative-distance.external: ${tokens[5]}`,
                'intra-area':  tokens => `ospf.administrative-distance.external: ${tokens[5]}`,
            },
            'area': (conv, tokens) => {
                if (!conv.get_memo('ospf.enable')) { return; }

                // route dynamic ospf area add <area-id> [range <IPaddress/prefixlen>]
                //     [stub {disable|enable}] [no-summary {on|off}] [default-cost <cost>]
                const params = conv.read_params(null, tokens, 5, {
                    'range': true,
                    'stub': true,
                    'no-summary': true,
                    'default-cost': true,
                });
                const k1 = conv.get_index('ospf.area');
                conv.param2recipe(params, '*NAME*', `${k1}.id`);
                conv.param2recipe(params, 'range', `${k1}.range`);
                conv.param2recipe(params, 'stub', `${k1}.type`, val => {
                    return (val == 'enable') ? 'stub' : 'normal';
                });
                conv.param2recipe(params, 'no-summary', `${k1}.stub.no-summary`, on2enable);
                conv.param2recipe(params, 'default-cost', `${k1}.stub.default-cost`);
            },

            // route dynamic ospf default-route-originate { disable | enable
            //    [metric <metric>] [metric-type <metric-type>] }
            'default-route-originate': {
                'disable': [],
                'enable': (conv, tokens) => {
                    if (!conv.get_memo('ospf.enable')) { return; }

                    conv.add('ospf.default-route-originate.originate', 'enable');
                    conv.read_params(null, tokens, 4, {
                        'metric': 'ospf.default-route-originate.set.metric',
                        'metric-type': 'ospf.default-route-originate.set.metric-type',
                    });
                },
            },
            'disable': [],
            'enable': (conv, tokens) => {
                if (conv.missing('route6 dynamic ospf')) { return; }
                const id = conv.get_memo('ospf.router-id');
                if (id == null) {
                    conv.badconfig('router-id が設定されていません。');
                    return;
                }
                conv.add('ospf.router-id', id);
                conv.set_memo('ospf.enable', true);
            },
            'link': (conv, tokens) => {
                if (!conv.get_memo('ospf.enable')) { return; }

                // route dynamic ospf link add <interface> area <area-id>
                //     [authentication auth-key <key-name>] [cost <cost>]
                //     [hello-interval <hello-interval>] [dead-interval <dead-interval>]
                //     [retransmit-interval <retransmit-interval>] [transmit-delay <transmit-delay>]
                //     [priority <priority>] [passive-interface {on|off}]
                const k1 = conv.get_index('ospf.link');
                conv.add(`${k1}.interface`, conv.ifmap(tokens[5]));

                const params = conv.read_params(null, tokens, 5, {
                    'area': `${k1}.area`,
                    'authentication': 0,  // ignore it
                    'auth-key': true,
                    'cost': `${k1}.cost`,
                    'hello-interval': `${k1}.hello-interval`,
                    'dead-interval': `${k1}.dead-interval`,
                    'retransmit-interval': `${k1}.retransmit-interval`,
                    'transmit-delay': `${k1}.transmit-delay`,
                    'priority': `${k1}.priority`,
                    'passive-interface': {
                        key: `${k1}.passive-interface`,
                        fun: on2enable,
                    },
                });
                if (params['auth-key']) {
                    const keyname = params['auth-key'];
                    const akey = conv.get_params('route.auth-key')[keyname];
                    if (akey['type'] == 'plain-text') {
                        conv.add(`${k1}.authentication.type`, 'plain-text');
                        conv.add(`${k1}.authentication.plain-text.password`, akey['password']);
                    } else if (akey['type'] == 'md5') {
                        conv.add(`${k1}.authentication.type`, 'md5');
                        conv.add(`${k1}.authentication.md5.key-id`, akey['keyid']);
                        conv.add(`${k1}.authentication.md5.secret-key`, akey['password']);
                    }
                }
            },

            'nexthop-calculation-type': 'notsupported',

            'router-id': (conv, tokens) => {
                // route dynamic ospf router-id <my-router-id>
                conv.set_memo('ospf.router-id', tokens[4]);
            },
        },

        'pim-sparse': {
            'disable': [],
            '*': 'notsupported',
        },

        // route dynamic redistribute { static-to-rip | ospf-to-rip | bgp-to-rip }
        //     { disable | enable [metric <metric>]
        //     [route-filter <route-filter-name>[,<route-filter-name>...]] }
        'redistribute': {
            'bgp-to-ospf': (conv, tokens) => {
                if (conv.get_memo('ospf.enable')) {
                    conv.add('ospf.redistribute-from.bgp.redistribute', tokens[4]);
                }
            },

            'bgp-to-rip': (conv, tokens) => {
                if (conv.get_memo('rip.enable')) {
                    conv.add('rip.redistribute-from.bgp.redistribute', tokens[4]);
                }
            },

            'connected-to-ospf': (conv, tokens) => {
                if (conv.get_memo('ospf.enable')) {
                    conv.add('ospf.redistribute-from.connected.redistribute', tokens[4]);
                }
            },

            'connected-to-rip': (conv, tokens) => {
                if (conv.get_memo('rip.enable')) {
                    conv.add('rip.redistribute-from.connected.redistribute', tokens[4]);
                }
            },

            'ospf-to-rip': (conv, tokens) => {
                if (conv.get_memo('rip.enable')) {
                    conv.add('rip.redistribute-from.ospf.redistribute', tokens[4]);
                }
            },

            // route dynamic redistribute { static-to-bgp | rip-to-bgp | ospf-to-bgp }
            //     { disable | enable [metric <metric>]
            //     [route-filter <route-filter-name>[,<route-filter-name>...]] }
            '*': (conv, tokens) => {
                const fromto = tokens[3].match(/^(\w+)-to-(\w+)$/);
                if (!fromto) {
                    conv.syntaxerror(tokens[3]);
                    return;
                };
                const from = fixup_ospf6(fromto[1]);
                const to = fixup_ospf6(fromto[2]);
                const to_prefix = (to == 'bgp') ? 'bgp.ipv4' : to;
                if (!conv.get_memo(`${to}.enable`)) { return; }

                const params = conv.read_params(null, tokens, 3, {
                    'metric': `${to_prefix}.redistribute-from.${from}.set.metric`,
                    'route-filter': true,
                    'enable': 0,
                    'disable': 0,
                });
                if (params['disable']) {
                    return;
                }
                conv.add(`${to_prefix}.redistribute-from.${from}.redistribute`, 'enable');
                (params['route-filter'] || "").split(',').forEach(name => {
                    route_filter(conv, `${to_prefix}.redistribute-from.${from}.filter`, name);
                });
            },

            'rip-to-ospf': (conv, tokens) => {
                // route dynamic redistribute rip-to-ospf {disable|enable}
                //     [metric <metric>] [metric-type <metric-type>]
                //     [route-filter <route-filter-name>[,<route-filter-name>...]]
                if (conv.get_memo('ospf.enable')) {
                    const r = tokens[3].match(/([a-z]+)-to-([a-z]+)/);
                    const from = r[1];
                    const to = r[2];

                    conv.add(`ospf.redistribute-from.${from}.redistribute`, tokens[4]);
                    const params = conv.read_params(null, tokens, 3, {
                        'disable': 0,
                        'enable': 0,
                        'metric': `${to}.redistribute-from.${from}.set.metric`,
                        'metric-type': `${to}.redistribute-from.${from}.set.metric-type`,
                        'route-filter': true,
                    });
                    (params['route-filter'] || "").split(',').forEach(name => {
                        const rf = conv.get_params('route-filter.ipv4')[name];
                        if (rf == null) {
                            return;
                        }
                        const k1 = conv.get_index(`${to}.redistribute-from.${from}.filter`);
                        conv.param2recipe(rf, 'interface', `${k1}.match.interface`, val => conv.ifmap(val));
                        conv.param2recipe(rf, 'network', `${k1}.match.prefix`, val => `${val}`);
                        conv.param2recipe(rf, 'set-metric', `${k1}.set.metric`);
                        conv.param2recipe(rf, 'set-metric-type', `${k1}.set.metric-type`);
                        if (rf['pass']) {
                            conv.add(`${k1}.action`, 'pass');
                        }
                        if (rf['block']) {
                            conv.add(`${k1}.action`, 'block');
                        }
                    });
                }
            },

            'static-to-rip': (conv, tokens) => {
                if (conv.get_memo('rip.enable')) {
                    conv.add('rip.redistribute-from.static.redistribute', tokens[4]);
                }
            },

            'static-to-ospf': (conv, tokens) => {
                return Converter.rules['route']['dynamic']['redistribute']['rip-to-ospf'](conv, tokens);
            },
        },

        'rip': {
            'default-route-originate': 'notsupported',

            'disable': [],

            'enable': (conv, tokens) => {
                if (conv.missing('route dynamic rip')) { return; }
                conv.set_memo('rip.enable', true);
            },

            'expire-timer': tokens => `rip.timer.expire: ${tokens[4]}`,

            'garbage-collection-timer': tokens => `rip.timer.garbage-collection: ${tokens[4]}`,

            'interface': {
                '*': {
                    'authentication': {
                        'auth-key': (conv, tokens) => {
                            // route dynamic rip interface <interface>
                            //     authentication auth-key <key-name>
                            const ifname = conv.ifmap(tokens[4]);
                            const k1 = conv.get_memo(`rip.interface.${ifname}`);
                            if (k1 == null) {
                                // route dynamic rip interface <if> disable
                                return;
                            }
                            if (!conv.get_memo(`rip.interface.${ifname}.authentication`)) {
                                // route dynamic rip interface <if> authentication disable
                                return;
                            }
                            const keyname = tokens[7];
                            const akey = conv.get_params('route.auth-key')[keyname];
                            if (akey['type'] == 'plain-text') {
                                conv.add(`${k1}.authentication.type`, 'plain-text');
                                conv.add(`${k1}.authentication.plain-text.password`, akey['password']);
                            } else if (akey['type' == 'md5']) {
                                conv.add(`${k1}.authentication.type`, 'md5');
                                conv.add(`${k1}.authentication.md5.key-id`, akey['keyid']);
                                conv.add(`${k1}.authentication.md5.secret-key`, akey['password']);
                            }
                        },

                        'disable': [],

                        'enable': (conv, tokens) => {
                            const ifname = conv.ifmap(tokens[4]);
                            conv.set_memo(`rip.interface.${ifname}.authentication`, true);
                        },
                    },

                    'disable': [],

                    'enable': (conv, tokens) => {
                        const ifname = conv.ifmap(tokens[4]);
                        const k1 = conv.get_index('rip.interface');
                        conv.set_memo(`rip.interface.${ifname}`, k1);
                        conv.add(`${k1}.interface`, ifname);
                    },

                    'listen-only': (conv, tokens) => {
                        const ifname = conv.ifmap(tokens[4]);
                        const k1 = conv.get_index('rip.interface');
                        conv.set_memo(`rip.interface.${ifname}`, k1);
                        conv.add(`${k1}.mode`, 'listen-only');
                    },

                    'route-filter': (conv, tokens) => {
                        // route dynamic rip interface <interface>
                        //     route-filter {in|out} <route-filter-name>[,<route-filter-name>...]
                        // XXX: notyet
                    },

                    'supply-only': (conv, tokens) => {
                        const ifname = conv.ifmap(tokens[4]);
                        const k1 = conv.get_index('rip.interface');
                        conv.set_memo(`rip.interface.${ifname}`, k1);
                        conv.add(`${k1}.mode`, 'supply-only');
                    },

                    'version': (conv, tokens) => {
                        // route dynamic rip interface <interface>
                        //     version { ripv1 | ripv2 | ripv2-broadcast }
                        const ifname = conv.ifmap(tokens[4]);
                        const k1 = conv.get_memo(`rip.interface.${ifname}`);
                        if (k1 == null) {
                            return;
                        }
                        conv.add(`${k1}.version`, tokens[6]);
                    },
                }
            },

            'update-timer': tokens => `rip.timer.update: ${tokens[4]}`,
        },

        'route-filter': (conv, tokens) => {
            // route dynamic route-filter add <filter-name>
            //     [network <IPaddress>[/<prefixlen>]
            //         [prefix <prefixlen>-<prefixlen> | exact-match] ]
            //     [interface <interface>] [metric <number>] { pass | block }
            //     [set-as-path-prepend <as-number>[,<as-number>...]]
            //     [set-metric <number>] [set-metric-type <number>] [set-weight <number>]
            conv.read_params('route-filter.ipv4', tokens, 4, {
                'network': true,
                'prefix': true,
                'exact-match': 0,
                'interface': true,
                'metric': true,
                'pass':  0,
                'block': 0,
                'set-as-path-prepend': true,
                'set-metric': true,
                'set-metric-type': true,
                'set-weight': true,
            });
        },
    },
};

function fixup_ospf6(str) {
    return (str == 'ospf') ? 'ospf6' : str;
}

Converter.rules['route6'] = {
    'add': (conv, tokens) => {
        // route6 add {<dst_IPv6address>/<prefixlen>|default}
        //     {<gateway_IPv6address>|<interface>|discard}
        //     [distance <distance>]
        //     [keepalive {on|off} [target <IPv6address>] [send-interval <interval>]
        //         [timeout <timeout>] [down-count <count>] [up-count <count>]
        // route6 add default router-advertisement interface <lan>
        //     [distance { <distance> | system-default }]
        const k1 = conv.get_index('route.ipv6');
        if (tokens[3] == 'router-advertisement') {
            const raif = conv.ifmap(tokens[5]);
            if (conv.missing('interface ... add router-advertisement(s)', true)) {
                const ralist = conv.get_memo('interface.router-advertisements');
                if (raif != ralist[0]) {
                    conv.warning(`${conv.devname} では router-advertisement で IPv6 アドレスを設定したインタフェースしか指定できません。`);
                    return;
                }
            } else {
                conv.add(`${k1}.router-advertisement-interface`, raif);
            }
            idx = 5;
        } else {
            idx = 3;
        }
        conv.add(`${k1}.destination`, tokens[2]);
        conv.add(`${k1}.gateway`, tokens[3]);
        const params = conv.read_params(null, tokens, idx, {
            'distance': `${k1}.distance`,
            'keepalive': {
                key: `${k1}.keepalive.service`,
                fun: on2enable,
            },
            'target': `${k1}.keepalive.target`,
            'send-interval': `${k1}.keepalive.send-interval`,
            'timeout': `${k1}.keepalive.timeout`,
            'down-count': `${k1}.keepalive.down-count`,
            'up-count': `${k1}.keepalive.up-count`,
        });
    },

    'dynamic': {
        // https://www.seil.jp/doc/index.html#fn/route/cmd/route6_dynamic_ospf.html
        'ospf': {
            'area': (conv, tokens) => {
                // route6 dynamic ospf area add <area-id> [range <IPaddress/prefixlen>]
                const params = conv.read_params(null, tokens, 5, {
                    'range': true,
                });
                const k1 = conv.get_index('ospf6.area');
                conv.param2recipe(params, '*NAME*', `${k1}.id`);
                conv.param2recipe(params, 'range', `${k1}.range.0.prefix`);
            },
            'disable': [],
            'enable': (conv, tokens) => {
                const id = conv.get_memo('ospf6.router-id');
                if (id == null) {
                    conv.badconfig('router-id が設定されていません。');
                    return;
                }
                conv.add('ospf6.router-id', id);
                conv.set_memo('ospf6.enable', true);
            },
            'link': (conv, tokens) => {
                // route6 dynamic ospf link add <interface> area <area-id> ...
                const k1 = conv.get_index('ospf6.link');
                conv.add(`${k1}.interface`, conv.ifmap(tokens[5]));

                conv.read_params(null, tokens, 5, {
                    'area': `${k1}.area`,
                    'instance-id': `${k1}.instance-id`,
                    'cost': `${k1}.cost`,
                    'hello-interval': `${k1}.hello-interval`,
                    'dead-interval': `${k1}.dead-interval`,
                    'retransmit-interval': `${k1}.retransmit-interval`,
                    'transmit-delay': `${k1}.transmit-delay`,
                    'priority': `${k1}.priority`,
                    'passive-interface': {
                        key: `${k1}.passive-interface`,
                        fun: on2enable,
                    },
                });
            },

            'router-id': (conv, tokens) => {
                // route6 dynamic ospf router-id <my-router-id>
                conv.set_memo('ospf6.router-id', tokens[4]);
            },
        },

        'pim-sparse': {
            'disable': [],
            '*': 'notsupported',
        },

        // https://www.seil.jp/doc/index.html#fn/route/cmd/route6_dynamic_redistribute.html
        'redistribute': {
            '*': {
                'disable': [],

                // route6 dynamic redistribute connected-to-ripng enable [metric <metric>]
                'enable': (conv, tokens) => {
                    const fromto = tokens[3].match(/^(\w+)-to-(\w+)$/);
                    if (!fromto) {
                        conv.syntaxerror(tokens[3]);
                        return;
                    };

                    const from = fixup_ospf6(fromto[1]);
                    const to   = fixup_ospf6(fromto[2]);

                    if (!conv.get_memo(`${to}.enable`)) {
                        return;
                    }
                    const k = `${to}.redistribute-from.${from}`
                    conv.add(`${k}.redistribute`, 'enable');
                    conv.read_params(null, tokens, 4, {
                        'metric': `${k}.set.metric`,
                        'metric-type': `${k}.set.metric-type`,
                    });
                },
            },
        },

        'ripng': {
            'default-route-originate': (conv, tokens) => {
                if (!conv.get_memo('ripng.enable')) { return; }
                conv.add('ripng.default-route-originate.originate', tokens[4]);
            },

            'disable': [],

            'enable': (conv, tokens) => {
                if (conv.missing('route6 dynamic ripng')) { return; }
                conv.set_memo('ripng.enable', true);
            },

            // route6 dynamic ripng interface <interface> ...
            'interface': {
                '*': {
                    'aggregate': (conv, tokens) => {
                        if (!conv.get_memo('ripng.enable')) { return; }

                        // route6 dynamic ripng interface <interface>
                        //     aggregate add <prefix/prefixlen> [metric <metric>]
                        const ifname = conv.ifmap(tokens[4]);
                        const k1 = conv.get_memo(`ripng.interface.${ifname}`);
                        if (k1 == null) {
                            return;
                        }
                        const k2 = conv.get_index(`${k1}.aggregate`);
                        conv.add(`${k2}.prefix`, tokens[7]);

                        if (tokens[8] == 'metric') {
                            conv.add(`${k2}.metric`, tokens[9]);
                        }
                    },
                    'disable': [],

                    'enable': (conv, tokens) => {
                        if (!conv.get_memo('ripng.enable')) { return; }

                        const ifname = conv.ifmap(tokens[4]);
                        const k1 = conv.get_index('ripng.interface');
                        conv.set_memo(`ripng.interface.${ifname}`, k1);
                        conv.add(`${k1}.interface`, ifname);

                        // supply-only と listen-only は enable の後に置かれる。
                        if (tokens[6]) {
                            conv.add(`${k1}.mode`, tokens[6]);
                        }
                    },

                    'route-filter': (conv, tokens) => {
                        // route dynamic rip interface <interface>
                        //     route-filter {in|out} <route-filter-name>[,<route-filter-name>...]
                        const ifname = conv.ifmap(tokens[4]);
                        const k1 = conv.get_memo(`ripng.interface.${ifname}`);

                        const inout = tokens[6];
                        tokens[7].split(',').forEach(name => {
                            route6_filter(conv, `${k1}.filter.${inout}`, name);
                        });
                    },
                }
            },
        },

        'route-filter': (conv, tokens) => {
            conv.read_params('route-filter.ipv6', tokens, 4, {
                'network': true,
                'prefix': true,
                'exact-match': 0,
                'interface': true,
                'pass':  0,
                'block': 0,
                'set-as-path-prepend': true,
                'set-metric': true,
                'set-metric-type': true,
                'set-weight': true,
            });
        },
    },
};

Converter.rules['rtadvd'] = {
    'disable': (conv, tokens) => {
        if (!conv.missing('rtadvd', true)) {
            conv.add('router-advertisement.service', 'disable')
        }
    },
    'enable': (conv, tokens) => {
        if (!conv.missing('rtadvd')) {
            conv.add('router-advertisement.service', 'enable')
        }
    },
    'interface': {
        '*': {
            'advertise': {
                'add': (conv, tokens) => {
                    const ifname = conv.ifmap(tokens[2]);
                    const k1 = conv.get_memo(`rtadvd.interface.${ifname}`);
                    if (k1 == null) {
                        return;
                    }
                    const k2 = conv.get_index(`${k1}.advertise`);
                    // rtadvd interface { <lan> | <vlan> } advertise
                    //     add { interface-prefix | <prefix>[/<prefixlen>] }
                    //     [valid-lifetime { infinity | <lifetime> }]
                    //     [fixed-valid-lifetime { on | off }]
                    //     [preferred-lifetime { infinity | <lifetime> }]
                    //     [fixed-preferred-lifetime { on | off }]
                    //     [autonomous-flag { on | off }] [onlink-flag { on | off }]
                    conv.read_params(null, tokens, 2, {
                        'advertise': 0,  // skip
                        'add': {
                            key: `${k2}.prefix`,
                            fun: val => {
                                if (val == 'interface-prefix') {
                                    return 'auto';
                                } else {
                                    return val;
                                }
                            }
                        },
                        'valid-lifetime': `${k2}.valid-lifetime`,
                        'fixed-valid-lifetime': 'deprecated',
                        'preferred-lifetime': `${k2}.preferred-lifetime`,
                        'fixed-preferred-lifetime': 'deprecated',
                        'autonomous-flag': {
                            key: `${k2}.autonomous-flag`,
                            fun: on2enable
                        },
                        'onlink-flag': {
                            key: `${k2}.onlink-flag`,
                            fun: on2enable
                        },
                    });
                },
                'auto': [],
                'manual': (conv, tokens) => {
                    const ifname = conv.ifmap(tokens[3]);
                    conv.set_memo(`rtadvd.interface.${ifname}`, conv.get_index('router-advertisement'));
                },
            },

            'dns': (conv, tokens) => {
                // rtadvd interface {<lan>|<vlan>} dns add <IPaddress>
                //     [lifetime { <lifetime> | infinity | system-default }]
                const ifname = conv.ifmap(tokens[2]);
                const k1 = conv.get_memo(`rtadvd.interface.${ifname}`);
                if (k1 == null) {
                    return;
                }
                const k2 = conv.get_index(`${k1}.dns`);
                conv.add(`${k2}.address`, tokens[5]);
                if (tokens[6] == 'lifetime') {
                    conv.add(`${k2}.lifetime`, tokens[7]);
                }
            },

            'disable': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[2]);
                conv.set_memo(`rtadvd.interface.${ifname}`, null);
            },

            'domain': (conv, tokens) => {
                // rtadvd interface {<lan>|<vlan>} domain add <domain>
                //     [lifetime { <lifetime> | infinity | system-default }]
                const ifname = conv.ifmap(tokens[2]);
                const k1 = conv.get_memo(`rtadvd.interface.${ifname}`);
                if (k1 == null) {
                    return;
                }
                const k2 = conv.get_index(`${k1}.domain`);
                conv.add(`${k2}.name`, tokens[5]);
                if (tokens[6] == 'lifetime') {
                    conv.add(`${k2}.lifetime`, tokens[7]);
                }
            },

            'enable': (conv, tokens) => {
                const ifname = conv.ifmap(tokens[2]);
                const k = conv.get_index('router-advertisement');
                conv.set_memo(`rtadvd.interface.${ifname}`, k);
                conv.add(`${k}.interface`, ifname);
            },

            '*': (conv, tokens) => {
                // rtadvd interface { <lan> | <vlan> } ...
                const ifname = conv.ifmap(tokens[2]);
                const k1 = conv.get_memo(`rtadvd.interface.${ifname}`);
                if (k1 == null) {
                    return;
                }
                conv.read_params(null, tokens, 2, {
                    'curhoplimit': `${k1}.curhoplimit`,
                    'managed-flag': {
                        key: `${k1}.managed-flag`,
                        fun: on2enable
                    },
                    'max-interval': `${k1}.max-interval`,
                    'min-interval': `${k1}.min-interval`,
                    'mtu': `${k1}.mtu`,
                    'other-flag': {
                         key: `${k1}.other-flag`,
                         fun: on2enable
                    },
                    'reachable-time': `${k1}.reachable-time`,
                    'retransmit-timer': `${k1}.retrans-timer`,
                    'router-lifetime': `${k1}.router-lifetime`,
                });
            }
        },
    }
};

Converter.rules['snmp'] = {
    // https://www.seil.jp/doc/index.html#fn/snmp/cmd/snmp.html
    'disable': 'snmp.service: disable',

    // snmp community <community>
    'community': tokens => `snmp.community: ${tokens[2]}`,

    'contact': tokens => `snmp.contact: ${tokens[2]}`,

    'enable': 'snmp.service: enable',

    'location': tokens => `snmp.location: ${tokens[2]}`,

    'security-model': {
        // snmp security-model community-based { on | off }
        'community-based': tokens => `snmp.security-model.community-based: ${on2enable(tokens[3])}`,

        // snmp security-model user-based { on | off }
        'user-based': tokens => `snmp.security-model.user-based: ${on2enable(tokens[3])}`,
    },

    'sysname': tokens => `snmp.sysname: ${tokens[2]}`,

    // https://www.seil.jp/doc/index.html#fn/snmp/cmd/snmp_trap.html
    'trap': {
        'add': (conv, tokens) => {
            // snmp trap add <IPaddress>
            const k1 = conv.get_index('snmp.trap.host');
            conv.add(`${k1}.address`, tokens[3]);
        },
        'disable': 'snmp.trap.service: disable',
        'enable': 'snmp.trap.service: enable',
        'src': tokens => `snmp.trap.agent-address: ${tokens[3]}`,
        'watch': {
            'add': (conv, tokens) => {
                const k1 = conv.get_index('snmp.trap.watch');
                const ti = conv.get_trap_index();
                conv.add(`${k1}.address`, tokens[4]);
                conv.add(`${k1}.trap-index`, ti);
                conv.read_params(null, tokens, 4, {
                    'errors': `${k1}.errors`,
                    'interval': `${k1}.interval`,
                    'interval-fail': `${k1}.interval-fail`,
                })
            },
        },
    },
};

Converter.rules['ssh-config'] = {
    '*': 'notsupported',
}

Converter.rules['sshd'] = {
    // https://www.seil.jp/doc/index.html#fn/ssh/cmd/sshd.html
    // https://www.seil.jp/sx4/doc/sa/shell/config/sshd.html

    'access': 'notsupported',

    'authorized-key': {
        'admin': (conv, tokens) => {
            if (conv.missing('sshd authorized-key admin')) { return; }
            // sshd authorized-key <user> add <name> { ssh-rsa | ssh-dss } <public_key>
            const k1 = conv.get_index('sshd.authorized-keys');
            const txt = `${tokens[5]} ${tokens[6]}`;
            conv.add(`${k1}.pubkey`, txt);
        },
        '*': 'notsupported',
    },

    // sshd { enable | disable }
    'disable': (conv, tokens) => {
        if (conv.get_memo('sshd.password-authentication') == null &&
            !conv.missing('sshd password-authentication enable', true)) {
            conv.add('sshd.password-authentication', 'enable');
        }
        conv.add('sshd.service', 'disable');
    },

    'enable': (conv, tokens) => {
        conv.set_memo('sshd.enable', true);
        if (conv.get_memo('sshd.password-authentication') == null) {
            conv.add('sshd.password-authentication', 'enable');
        }
        conv.add('sshd.service', 'enable');
    },

    // sshd hostkey { rsa1 | rsa | dsa } { <hostkey> | auto | none }
    'hostkey': (conv, tokens) => {
        if (tokens[3] == 'auto' || tokens[3] == 'none') {
            return;
        } else if (tokens[2] == 'rsa') {
            if (conv.missing('sshd hostkey')) { return; }
            const key = tokens[3] || "";
            var i = key.indexOf(",");
            if (i < 0) {
                conv.badconfig('invalid rsa host key');
                return;
            }
            var str = '';
            for (i = i + 1; i < key.length; i += 2) {
                hex = parseInt(key.substring(i, i + 2), 16);
                if (hex != 0x0a) {
                    str += String.fromCharCode(hex);
                } else {
                    str += "\\n";
                }
            }
            conv.add('sshd.hostkey', str);
        } else {
            conv.notsupported(`sshd hostkey ${tokens[2]}`);
        }
    },

    'password-authentication': (conv, tokens) => {
        if (conv.missing('sshd password-authentication enable')) { return; }
        // sshd password-authentication { on | off | system-default }
        conv.set_memo('sshd.password-authentication', tokens[2]);
        conv.add('sshd.password-authentication', on2enable(tokens[2]));
    },
};

Converter.rules['syslog'] = {
    // https://www.seil.jp/doc/index.html#fn/syslog/cmd/syslog.html
    // https://www.seil.jp/sx4/doc/sa/syslog/config/syslog.html

    'add': (conv, tokens) => {
        // syslog add <IPaddress>
        const k1 = conv.get_index('syslog.remote.server', true);
        const addr = tokens[2];
        if (addr.is_ipv4_address()) {
            conv.add(`${k1}.ipv4.address`, addr);
        } else if (!conv.missing('syslog remote ipv6', true)) {
            conv.add(`${k1}.ipv6.address`, addr);
        } else {
            conv.notsupported(addr);
        }
        if (conv.get_memo('syslog.facility')) {
            conv.add(`${k1}.facility`, conv.get_memo('syslog.facility'));
        }
        if (conv.get_memo('syslog.sequence-number')) {
            conv.add(`${k1}.sequence-number`, on2enable(conv.get_memo('syslog.sequence-number')));
        }
        if (conv.get_memo('syslog.alternate-timestamp')) {
            conv.add(`${k1}.alternate-timestamp`, on2enable(conv.get_memo('syslog.alternate-timestamp')));
        }
    },

    'alternate-timestamp': (conv, tokens) => {
        conv.set_memo('syslog.alternate-timestamp', tokens[2]);
    },

    'clear-password': 'notsupported',

    'command-log': 'notsupported',

    // syslog debug-level { on | off }
    'debug-level': (conv, tokens) => {
        // off の場合は無視して良い。
        if (tokens[2] == 'on') {
            conv.notsupported('syslog debug-level');
        }
    },

    'facility': (conv, tokens) => {
        conv.set_memo('syslog.facility', tokens[2]);
    },

    'memory-block': (conv, tokens) => {
        // syslog memory-block <function> { <blocks> | system-default }
        const oldfun = tokens[2] || '???';
        var newfun = oldfun;
        switch (oldfun) {
            case 'application-gateway':
                newfun = 'appgw';
                break;
            case 'filter':
                newfun = 'ipf';
                break;
            case 'hdlc':
            case 'ip':
            case 'isdn':
            case 'snmp':
                conv.deprecated(oldfun);
                return;;
            case 'http':
            case 'queue':
            case 'system':
            case 'telnet':
                conv.notsupported(oldfun);
                return;
        }
        const k1 = conv.get_index('syslog.memory-block');
        conv.add(`${k1}.function`, newfun);
        conv.add(`${k1}.size`, tokens[3] || '???');
    },

    'remote': {
        'on': (conv, tokens) => {
            conv.set_memo('syslog.remote', 'on');
        },
        'off': [],
    },

    'remote-server': (conv, tokens) => {
        // syslog remote-server add <name> address <IPaddress>
        //     [port <port>] [hostname <hostname>] [facility <facility>]
        //     [sequence-number {on|off}] [alternate-timestamp {on|off}]
        //     [log-level <level>] [src {<IPaddress>|auto}]
        if (conv.get_memo('syslog.remote') != 'on') {
            return;
        }
        const k1 = conv.get_index('syslog.remote.server', true);
        const params = conv.read_params(null, tokens, 3, {
            'address': true,
            'port': `${k1}.port`,
            'hostname': `${k1}.hostname`,
            'facility': `${k1}.facility`,
            'sequence-number': {
                key: `${k1}.sequence-number`,
                fun: on2enable
            },
            'alternate-timestamp': {
                key: `${k1}.alternate-timestamp`,
                fun: on2enable
            },
            'log-level': `${k1}.log-level`,
            'src': true
        });

        const addr = params['address'];
        if (addr.is_ipv4_address()) {
            conv.add(`${k1}.ipv4.address`, addr);
        } else if (!conv.missing('syslog remote ipv6', true)) {
            conv.add(`${k1}.ipv6.address`, addr);
        } else {
            conv.notsupported(addr);
        }

        const src = params['src'];
        if (src) {
            if (src.is_ipv4_address()) {
                conv.add(`${k1}.source.ipv4.address`, src);
            } else if (!conv.missing('syslog remote ipv6', true)) {
                conv.add(`${k1}.source.ipv6.address`, src);
            } else {
                conv.notsupported(addr);
            }
        }
    },

    'sequence-number': (conv, tokens) => {
        conv.set_memo('syslog.sequence-number', tokens[2]);
    },
};

Converter.rules['telnetd'] = {
    'access': 'deprecated',

    // telnetd { enable | disable }
    'enable': (conv, tokens) => {
        if (conv.missing('telnetd')) { return; }
        conv.add('telnetd.service', 'enable');
        conv.set_memo('telnetd.enable', true);
    },
    'disable': 'telnetd.service: disable'
};

Converter.rules['timezone'] = (conv, tokens) => {
    // https://www.seil.jp/doc/index.html#fn/timezone/cmd/timezone.html
    // https://www.seil.jp/sx4/doc/sa/option/config/option.html

    // timezone <zone>
    const seiltz = unquote(tokens[1]);
    var tz = ""
    if (seiltz == "Japan") {
        tz = "JST";
    }
    conv.add('option.timezone', tz);
};

Converter.rules['translator'] = {
    // translator timeout は factory-config に入っているので無視しておく。
    'timeout': [],
    '*': 'notsupported',
};

Converter.rules['unicast-rpf'] = (conv, tokens) => {
    conv.notsupported()
};

Converter.rules['vendor'] = [];

function vrrp_route_up(params, watch) {
    if (watch['route-up'] == 'default') {
        if (params['address'].is_ipv4_address()) {
            return '0.0.0.0/0';
        } else {
            return '::/0';
        }
    } else {
        return watch['route-up'];
    }
}

Converter.rules['vrrp'] = {
    '*': (conv, tokens) => {
        // vrrp {<lan>|<vlan>} add vrid <vrid> address <IPv4address>/<prefixlen>
        //     [address <IPv4address>/<prefixlen>] [priority <priority>] [interval <interval>]
        //     [watch <group_name>] [preempt { on | off } ] [virtual-mac { on | off }] [delay <delay>]
        //     [dead-detect <times>] [alive-detect <times>] [enable | disable]
        if (tokens[tokens.length - 1] == 'disable') {
            return;
        }
        const k1 = conv.get_index('vrrp.vrouter');
        conv.add(`${k1}.version`, '2');
        conv.add(`${k1}.interface`, conv.ifmap(tokens[1]));
        const params = conv.read_params(null, tokens, 2, {
            'vrid': `${k1}.vrid`,
            'address': true,
            'priority': `${k1}.priority`,
            'interval': `${k1}.interval`,
            'watch': true,
            'preempt': true,
            'virtual-mac': true,
            'delay': `${k1}.delay`,
            'dead-detect': true,
            'alive-detect': true,
        });

        const m = params['address'].match(/^(\S+)\/(\d+)$/);
        if (m) {
            if (m[2] != '32') {
                conv.warning(`${conv.devname} では address のプレフィクス長は /32 固定です。`);
            }
            conv.add(`${k1}.address`, m[1]);
        } else {
            conv.add(`${k1}.address`, params['address']);
        }

        if (params['preempt']) {
            if (params['preempt'] == 'off') {
                conv.add(`${k1}.preempt`, 'disable');
            } else if (params['preempt'] != 'on') {
                conv.syntaxerror(`preempt ${params['preempt']}`);
            }
        }

        if (params['virtual-mac'] == null || params['virtual-mac'] == 'off') {
            conv.add(`${k1}.virtual-mac`, 'disable');
        }

        if (params['watch'] && conv.missing('vrrp add ... watch')) { return; }
        if (params['watch']) {
            const watch = conv.get_params('vrrp.watch-group')[params['watch']];
            if (watch['interface']) {
                conv.add(`${k1}.watch.interface`, conv.ifmap(watch['interface']));
            }
            if (watch['keepalive']) {
                conv.add(`${k1}.watch.keepalive`, watch['keepalive']);
            }
            if (watch['route-up']) {
                conv.add(`${k1}.watch.route-up`, vrrp_route_up(params, watch));
            }
        }
        conv.param2recipe(params, 'dead-detect', `${k1}.watch.dead-detect`);
        conv.param2recipe(params, 'alive-detect', `${k1}.watch.alive-detect`);
    },
    'watch-group': (conv, tokens) => {
        // vrrp watch-group add <name>
        //     [interface { <lan> | <pppoe> | <ppp> }]
        //     [keepalive <IPv4address>]
        //     [route-up <IPv4address>/<prefixlen>] ...
        //     [route-down <IPv4address>/<prefixlen>] ...
        conv.read_params('vrrp.watch-group', tokens, 3, {
            'interface': true,
            'keepalive': true,
            'route-up': true,
            'route-down': 'deprecated',
        });
    },
};

Converter.rules['vrrp3'] = {
    '*': (conv, tokens) => {
        // vrrp3 add <name> interface {<lan>|<vlan>} vrid <vrid>
        //     address <IPaddress> [address2 <IPaddress>] [priority <priority>] [interval <interval>]
        //    [watch <group_name>] [preempt { on | off }] [delay <delay>] [enable | disable]
        if (tokens[tokens.length - 1] == 'disable') {
            return;
        }
        const k1 = conv.get_index('vrrp.vrouter');
        conv.add(`${k1}.version`, '3');
        const params = conv.read_params(null, tokens, 2, {
            'interface': {
                key: `${k1}.interface`,
                fun: val => conv.ifmap(val)
            },
            'vrid': `${k1}.vrid`,
            'address': `${k1}.address`,
            'address2': 'notsupported',
            'priority': `${k1}.priority`,
            'interval': `${k1}.interval`,
            'watch': true,
            'preempt': true,
            'delay': `${k1}.delay`,
        });

        if (params['preempt']) {
            if (params['preempt'] == 'off') {
                conv.add(`${k1}.preempt`, 'disable');
            } else if (params['preempt'] != 'on') {
                conv.syntaxerror(`preempt ${params['preempt']}`);
            }
        }

        if (params['watch']) {
            const watch = conv.get_params('vrrp3.watch-group')[params['watch']];
            if (watch['interface']) {
                conv.add(`${k1}.watch.interface`, conv.ifmap(watch['interface']));
            }
            if (watch['keepalive']) {
                conv.add(`${k1}.watch.keepalive`, watch['keepalive']);
            }
            if (watch['alive-detect']) {
                conv.add(`${k1}.watch.alive-detect`, watch['alive-detect']);
            }
            if (watch['dead-detect']) {
                conv.add(`${k1}.watch.dead-detect`, watch['dead-detect']);
            }
            if (watch['route-up']) {
                conv.add(`${k1}.watch.route-up`, vrrp_route_up(params, watch));
            }
        }
    },
    'watch-group': (conv, tokens) => {
        // vrrp3 watch-group add <name>
        //     [interface {<lan>|<vlan>|<pppoe>|<ppp>|<wwan>}]
        //     [keepalive <IPaddress>] [alive-detect <num>] [dead-detect <num>]
        //     [route-up <IPaddress>/<prefixlen>] [route-down <IPaddress>/<prefixlen>]
        conv.read_params('vrrp3.watch-group', tokens, 3, {
            'interface': true,
            'keepalive': true,
            'alive-detect': true,
            'dead-detect': true,
            'route-up': true,
            'route-down': 'deprecated',
        });
    },
};

Converter.rules['wol-target'] = {
    '*': 'notsupported',
};

if (typeof exports !== 'undefined') {
    exports.Converter = Converter;
}
