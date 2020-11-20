const s2r = require('../seil2recipe');
const assert = require('assert');


const default_config_set = new Set(new s2r.Converter('', 'test').recipe_config.trim().split('\n'));

function assertconv(seil_config, recipe_config) {
    if (recipe_config == null) {
        [ seil_config, recipe_config ] = seil_config.split("---\n");
        if (recipe_config == null) {
            assert.fail('no separator found!');
        }
    }

    if (seil_config instanceof Array) {
        seil_config = seil_config.join('\n');
    }
    const c = new s2r.Converter(seil_config + '\n', 'test');

    var actual = c.recipe_config.trim().split('\n').filter(line => {
        return !default_config_set.has(line);
    });
    actual.sort();

    var expected = recipe_config;
    if (!(expected instanceof Array)) {
        expected = expected.replace(/(?<=^[^:]+):  +/gm, ': ')
            .split('\n')
            .map(line => line.trim())
            .filter(line => { return line != '' });
    }
    expected.sort();

    assert.deepStrictEqual(actual, expected, '');
}

function assert_conversions(seil_config, fun) {
    if (seil_config instanceof Array) {
        seil_config = seil_config.join('\n');
    }
    const c = new s2r.Converter(seil_config + '\n', 'test');
    fun.call(null, c.conversions);
}


describe('application-gateway', () => {
    it('is not supported.', () => {
        assertconv('application-gateway input-interface add lan0', '');
    });
});

describe('arp', () => {
    it('add ...', () => {
        assertconv('arp add 192.168.0.1 2:4:6:8:a:c proxy on', [
            'arp.100.ipv4-address: 192.168.0.1',
            'arp.100.mac-address: 2:4:6:8:a:c',
            'arp.100.proxy: enable'
        ])
    });

    it('reply-nat on', () => {
        assertconv(`
            arp reply-nat on
            ---
            nat.ipv4.arpreply: enable
        `);
    });
});

describe('authentication+pppac', () => {
    it('realm', () => {
        assertconv([
            'authentication realm add REALM1 type local username-suffix @example.jp',
            'authentication realm add REALM3 type account-list',
            'authentication local REALM1 user add user_a password PASSWORD framed-ip-address 172.16.0.1 framed-ip-netmask 255.255.255.255',
            'authentication account-list REALM3 url http://example.jp/ interval 123',
            'pppac pool add POOL1 address 192.168.128.0/24',
            'pppac ipcp-configuration add IPCP1 pool POOL1',
            'pppac protocol l2tp add PROTO1 accept-interface lan0,vlan1 idle-timer 123',
            'interface pppac0 ipcp-configuration IPCP1',
            'interface pppac0 bind-tunnel-protocol PROTO1',
            'interface pppac0 bind-realm REALM1',
            'interface pppac0 tunnel-end-address 192.168.127.1',
            'interface pppac1 ipcp-configuration IPCP1',
            'interface pppac1 bind-tunnel-protocol PROTO1',
            'interface pppac1 bind-realm REALM3',
            'ipsec anonymous-l2tp-transport enable',
            'ipsec anonymous-l2tp-transport preshared-key SecretKey',
         ], [
                'interface.pppac0.authentication.100.realm.suffix: @example.jp',
                'interface.pppac0.authentication.100.user.100.framed-ip-address: 172.16.0.1',
                'interface.pppac0.authentication.100.user.100.framed-ip-netmask: 255.255.255.255',
                'interface.pppac0.authentication.100.user.100.name: user_a',
                'interface.pppac0.authentication.100.user.100.password: PASSWORD',
                'interface.pppac0.ipcp.pool.100.address: 192.168.128.0',
                'interface.pppac0.ipcp.pool.100.count: 256',
                'interface.pppac0.ipv4.address: 192.168.127.1',
                'interface.pppac0.l2tp.accept.100.interface: ge1',
                'interface.pppac0.l2tp.accept.200.interface: vlan1',
                'interface.pppac0.l2tp.idle-timer: 123',
                'interface.pppac0.l2tp.ipsec.preshared-key: SecretKey',
                'interface.pppac0.l2tp.ipsec.requirement: required',
                'interface.pppac0.l2tp.service: enable',
                'interface.pppac1.authentication.100.account-list.interval: 123',
                'interface.pppac1.authentication.100.account-list.url: http://example.jp/',
                'interface.pppac1.ipcp.pool.100.address: 192.168.128.0',
                'interface.pppac1.ipcp.pool.100.count: 256',
                'interface.pppac1.l2tp.accept.100.interface: ge1',
                'interface.pppac1.l2tp.accept.200.interface: vlan1',
                'interface.pppac1.l2tp.idle-timer: 123',
                'interface.pppac1.l2tp.ipsec.preshared-key: SecretKey',
                'interface.pppac1.l2tp.ipsec.requirement: required',
                'interface.pppac1.l2tp.service: enable',
            ]);
    });
});

describe('bridge', () => {
    it('legacy bridge => interface.bridge0...', () => {
        assertconv([
            'bridge enable',
            'bridge ip-bridging on',
            'bridge ipv6-bridging on',
            'bridge pppoe-bridging on',
            'bridge default-bridging on',
        ], [
            'interface.bridge0.forward.ipv4: enable',
            'interface.bridge0.forward.ipv6: enable',
            'interface.bridge0.forward.other: enable',
            'interface.bridge0.forward.pppoe: enable',
            'interface.bridge0.member.100.interface: ge1',
            'interface.bridge0.member.200.interface: ge0',
        ]);
    });

    it('legacy bridge config in factory-config', () => {
        assertconv([
            'bridge disable',
            'bridge ip-bridging on',
            'bridge ipv6-bridging on',
        ], []);
    });

    it('bridge group => interface.bridge0...', () => {
        assertconv([
            'bridge group add BG stp off',
            'bridge interface lan1 group BG stp off',
            'bridge interface vlan2 group BG stp off',
        ], [
                'interface.bridge0.member.100.interface: ge0',
                'interface.bridge0.member.200.interface: vlan2',
            ]);
    });

    it('filter is not supported.', () => {
        assertconv('bridge filter on', '');
    });

    it('vman-tpid is not supported.', () => {
        assertconv('bridge vman-tpid 0x1234', '');
    });
});

describe('cbq', () => {
    it('simple', () => {
        assertconv(`
            interface lan1 queue cbq
            cbq link-bandwidth 1Gbps
            cbq class add ALL parent default pbandwidth 20 borrow off
            cbq filter add ALL4 class ALL category ip
            ---
            qos.service:                              enable
            qos.interface.100.default-class:          root
            qos.interface.100.class.class0.label:     ALL
            qos.interface.100.class.class0.parent:    root
            qos.interface.100.class.class0.bandwidth: 200
            qos.interface.100.class.class0.borrow:    disable
            qos.interface.100.interface:              ge0
            qos.filter.ipv4.100.direction:            out
            qos.filter.ipv4.100.interface:            any
            qos.filter.ipv4.100.label:                ALL4
            qos.filter.ipv4.100.marking.qos-class: class0
        `);
    });

    it('more parameters', () => {
        assertconv(`
            interface lan1 queue cbq
            cbq link-bandwidth 1Gbps
            cbq class add C0 parent default pbandwidth 50 borrow off priority 2
            cbq class add C1 parent C0 pbandwidth 20 borrow on priority 3
            cbq filter add F0 class C0 category ip protocol tcp tos 0x12/0x56 src 192.168.0.1/32 srcport 1 dst 192.168.0.2/32 dstport 2 enable
            cbq filter add F1 class C1 category ipv6 protocol udp src 2001:db8:1::/48 dst 2001:db8:2::/48
            ---
            qos.service:                              enable
            qos.interface.100.default-class:          root
            qos.interface.100.class.class0.label:     C0
            qos.interface.100.class.class0.parent:    root
            qos.interface.100.class.class0.bandwidth: 500
            qos.interface.100.class.class0.borrow:    disable
            qos.interface.100.class.class0.priority:  2
            qos.interface.100.class.class1.label:     C1
            qos.interface.100.class.class1.parent:    class0
            qos.interface.100.class.class1.bandwidth: 200
            qos.interface.100.class.class1.borrow:    enable
            qos.interface.100.class.class1.priority:  3
            qos.interface.100.interface:              ge0
            qos.filter.ipv4.100.direction:            out
            qos.filter.ipv4.100.interface:            any
            qos.filter.ipv4.100.label:                F0
            qos.filter.ipv4.100.marking.qos-class: class0
            qos.filter.ipv4.100.tos: 0x12/0x56
            qos.filter.ipv4.100.protocol: tcp
            qos.filter.ipv4.100.source.address: 192.168.0.1/32
            qos.filter.ipv4.100.source.port: 1
            qos.filter.ipv4.100.destination.address: 192.168.0.2/32
            qos.filter.ipv4.100.destination.port: 2
            qos.filter.ipv6.100.direction:            out
            qos.filter.ipv6.100.interface:            any
            qos.filter.ipv6.100.label:                F1
            qos.filter.ipv6.100.marking.qos-class: class1
            qos.filter.ipv6.100.protocol: udp
            qos.filter.ipv6.100.source.address: 2001:db8:1::/48
            qos.filter.ipv6.100.destination.address: 2001:db8:2::/48
        `);
    });

    it('link-bandwidth should be ignored', () => {
        assertconv('cbq link-bandwidth 100Mbps', '');
    });
});

describe('certificate', () => {
    it('is not supported', () => {
        assert_conversions('certificate my add FOO certificate ...', convs => {
            assert(convs[0].errors[0].type == 'notsupported');
        });
    });
});

describe('dhcp', () => {
    it('server enable/disable', () => {
        assertconv([
            'dhcp enable',
            'dhcp mode server'
        ], [
            'dhcp.server.service: enable'
        ]);
    });

    it('server disabled (x86 Fuji factory-config)', () => {
        assertconv([
            'interface lan0 add 192.168.0.1/24',
            'dhcp disable',
            'dhcp mode server',
            'dhcp interface lan0 enable',
            'dhcp interface lan0 expire 24',
            'dhcp interface lan0 pool 192.168.0.2 253',
            'dhcp interface lan0 dns add 192.168.0.1',
        ], [
                'interface.ge1.ipv4.address: 192.168.0.1/24',
                'dhcp.server.service: disable',
                'dhcp.server.100.interface: ge1',
                'dhcp.server.100.expire: 24',
                'dhcp.server.100.pool.address: 192.168.0.2/24',
                'dhcp.server.100.pool.count: 253',
                'dhcp.server.100.dns.100.address: 192.168.0.1',
            ]);
    });

    it('server interfaces', () => {
        assertconv([
            'dhcp enable',
            'dhcp mode server',
            'dhcp interface lan0 enable',
            'dhcp interface lan0 dns add 192.168.0.253',
            'dhcp interface lan0 dns add 192.168.0.254',
            'dhcp interface lan0 domain example.jp',
            'dhcp interface lan0 expire 24',
            'dhcp interface lan0 gateway 192.168.0.1',
            'dhcp interface lan0 ignore-unknown-request on',
            'dhcp interface lan0 ntp add 192.168.0.251',
            'dhcp interface lan0 ntp add 192.168.0.252',
            'dhcp interface lan0 wins-node b-node',
            'dhcp interface lan0 wins-server add 192.168.0.250',
            'dhcp interface lan0 wpad http://proxy.example.jp/',
            'dhcp interface lan0 static add 02:00:00:00:00:01 192.168.0.11',
            'dhcp interface lan0 static external url http://proxy.example.jp/list.txt',
            'dhcp interface lan0 static external interval 01h02m03s',
            'dhcp interface lan1 disable',
            'dhcp interface lan1 dns add 192.168.1.254',
        ], [
            'dhcp.server.100.dns.100.address: 192.168.0.253',
            'dhcp.server.100.dns.200.address: 192.168.0.254',
            'dhcp.server.100.domain: example.jp',
            'dhcp.server.100.expire: 24',
            'dhcp.server.100.gateway: 192.168.0.1',
            'dhcp.server.100.interface: ge1',
            'dhcp.server.100.ignore-unknown-request: enable',
            'dhcp.server.100.ntp.100.address: 192.168.0.251',
            'dhcp.server.100.ntp.200.address: 192.168.0.252',
            'dhcp.server.100.wins-node.type: b-node',
            'dhcp.server.100.wins-server.100.address: 192.168.0.250',
            'dhcp.server.100.wpad.url: http://proxy.example.jp/',
            'dhcp.server.100.static.entry.100.mac-address: 02:00:00:00:00:01',
            'dhcp.server.100.static.entry.100.ip-address: 192.168.0.11',
            'dhcp.server.100.static.external.url: http://proxy.example.jp/list.txt',
            'dhcp.server.100.static.external.interval: 01h02m03s',
            'dhcp.server.service: enable',
        ]);
    });

    it('prefix length of pool can be omitted!', () => {
        assertconv([
            'interface lan0 add 192.168.0.254/24',
            'dhcp enable',
            'dhcp mode server',
            'dhcp interface lan0 enable',
            'dhcp interface lan0 pool 192.168.0.10 30',
        ], [
            'interface.ge1.ipv4.address: 192.168.0.254/24',
            'dhcp.server.service: enable',
            'dhcp.server.100.pool.address: 192.168.0.10/24',
            'dhcp.server.100.pool.count: 30',
            'dhcp.server.100.interface: ge1',
        ]);
    });

    it('relay enable/disable', () => {
        assertconv([
            'dhcp enable',
            'dhcp mode relay'
        ], [
            'dhcp.relay.service: enable'
        ]);
    });

    it('relay interfaces', () => {
        assertconv([
            'dhcp enable',
            'dhcp mode relay',
            'dhcp interface lan0 enable',
            'dhcp interface lan0 server add 192.168.0.253',
            'dhcp interface lan0 server add 192.168.0.254',
            'dhcp interface lan1 disable',
            'dhcp interface lan1 server add 192.168.1.254',
        ], [
                'dhcp.relay.100.interface: ge1',
                'dhcp.relay.100.server.100.address: 192.168.0.253',
                'dhcp.relay.100.server.200.address: 192.168.0.254',
                'dhcp.relay.service: enable',
            ]);
    });
});

describe('dhcp6', () => {
    it('legacy single clinet configuration', () => {
        assertconv([
            'dhcp6 client enable',
            'dhcp6 client interface lan1',
            'dhcp6 client prefix-delegation subnet lan0 sla-id 0x1 interface-id ::1234 enable',
        ], [
                'dhcp6.client.service: enable',
                'dhcp6.client.100.interface: ge0',
                'dhcp6.client.100.prefix-delegation.100.subnet: ge1',
                'dhcp6.client.100.prefix-delegation.100.sla-id: 0x1',
                'dhcp6.client.100.prefix-delegation.100.interface-id: ::1234',
            ]);
    });

    it('can be run on multiple interfaces', () => {
        assertconv(`
            dhcp6 client enable
            dhcp6 client multiple enable
            dhcp6 client primary-interface lan1
            dhcp6 client interface lan0 enable
            dhcp6 client interface lan0 prefix-delegation force-option on
            dhcp6 client interface lan1 enable
            dhcp6 client interface lan1 prefix-delegation add lan1 sla-id 0x1234 interface-id ::2345 enable
            dhcp6 client interface lan2 disable
            ---
            dhcp6.client.service: enable
            dhcp6.client.100.interface: ge0
            dhcp6.client.100.prefix-delegation.100.subnet: ge0
            dhcp6.client.100.prefix-delegation.100.sla-id: 0x1234
            dhcp6.client.100.prefix-delegation.100.interface-id: ::2345
            dhcp6.client.200.interface: ge1
            dhcp6.client.200.prefix-delegation.force: enable
        `);
    });

    describe('server', () => {
        it('supports almost all parameters', () => {
            assertconv(`
                dhcp6 server interface lan0 enable
                dhcp6 server interface lan0 domain add example.jp
                dhcp6 server interface lan0 dns add 2001:db8::1
                dhcp6 server interface lan0 dns add dhcp6 from lan1
                dhcp6 server interface lan0 sntp add 2001:db8::2
                dhcp6 server interface lan0 sntp add dhcp6 from vlan0
                dhcp6 server interface lan0 preference 3
                ---
                dhcp6.server.service: enable
                dhcp6.server.100.interface: ge1
                dhcp6.server.100.domain: example.jp
                dhcp6.server.100.dns.100.address: 2001:db8::1
                dhcp6.server.100.dns.200.address: dhcp6
                dhcp6.server.100.dns.200.client-interface: ge0
                dhcp6.server.100.sntp.100.address: 2001:db8::2
                dhcp6.server.100.sntp.200.address: dhcp6
                dhcp6.server.100.sntp.200.client-interface: vlan0
                dhcp6.server.100.preference: 3
            `);
        });
    });

    describe('relay', () => {
        it('simple', () => {
            assertconv(`
                dhcp6 relay interface lan0 enable
                dhcp6 relay interface lan0 server add 2001:db8::1
                ---
                dhcp6.relay.service: enable
                dhcp6.relay.100.interface: ge1
                dhcp6.relay.100.server.100.address: 2001:db8::1
            `);
        });
    });
});

describe('dialup-device', () => {
    it('as a ppp interface', () => {
        assertconv(`
            ppp add PPP ipcp enable ipcp-address on ipcp-dns on ipv6cp enable identifier pppuser@mobile.example.jp passphrase ppppass keepalive 8 auto-connect ondemand idle-timer 30
            dialup-device access-point add AP cid 2 apn example.jp pdp-type ip
            dialup-device mdm0 connect-to AP pin 1234 auto-reset-fail-count 10
            dialup-device mdm0 device-option ux312nc-3g-only on
            dialup-device keepalive-send-interval 30
            dialup-device keepalive-down-count 20
            dialup-device keepalive-timeout 3
            interface ppp0 over mdm0
            interface ppp0 ppp-configuration PPP
            ---
            interface.ppp0.apn: example.jp
            interface.ppp0.auto-connect: ondemand
            interface.ppp0.auto-reset-fail-count: 10
            interface.ppp0.auto-reset-keepalive.down-detect-time: 10
            interface.ppp0.auto-reset-keepalive.reply-timeout: 3
            interface.ppp0.cid: 2
            interface.ppp0.device-option.ux312nc-3g-only: enable
            interface.ppp0.dialup-device: mdm0
            interface.ppp0.id: pppuser@mobile.example.jp
            interface.ppp0.idle-timer: 30
            interface.ppp0.ipcp: enable
            interface.ppp0.ipcp.address: enable
            interface.ppp0.ipcp.dns: enable
            interface.ppp0.ipv6cp: enable
            interface.ppp0.password: ppppass
            interface.ppp0.pdp-type: ip
            interface.ppp0.pin: 1234
            interface.ppp0.keepalive: 8
        `);
    });

    it('as a wwan interface', () => {
        assertconv([
            'dialup-device access-point add AP apn example.jp',
            'dialup-device mdm0 connect-to AP',
            'dialup-device mdm0 authentication-method chap username foo password bar auto-connect always idle-timer 30',
            'interface wwan0 over mdm0',
            'interface wwan0 add dhcp',
        ], [
            'interface.wwan0.apn: example.jp',
            'interface.wwan0.auth-method: chap',
            'interface.wwan0.auto-connect: always',
            'interface.wwan0.dialup-device: mdm0',
            'interface.wwan0.idle-timer: 30',
            'interface.wwan0.id: foo',
            'interface.wwan0.ipv4.address: dhcp',
            'interface.wwan0.password: bar',
        ]);
    });
});

describe('dialup-network', () => {
    it('basic', () => {
        assertconv(`
            dialup-network l2tp-dn0 connect-to 172.16.0.1 ipsec-preshared-key "ipsecpskey"
            ppp add DUN ipcp enable ipcp-address on authentication-method mschapv2 identifier foo passphrase bar
            interface ppp0 over l2tp-dn0
            interface ppp0 ppp-configuration DUN
            ---
            interface.rac0.id: foo
            interface.rac0.ipcp: enable
            interface.rac0.ipcp.address: enable
            interface.rac0.ipsec-preshared-key: ipsecpskey
            interface.rac0.password: bar
            interface.rac0.server.ipv4.address: 172.16.0.1
        `);
    });
});

describe('dns forwarder', () => {
    it('add ...', () => {
        assertconv([
            'dns forwarder enable',
            'dns forwarder add 192.168.0.1',
            'dns forwarder add 192.168.0.2',
        ], [
                'dns-forwarder.100.address: 192.168.0.1',
                'dns-forwarder.200.address: 192.168.0.2',
                'dns-forwarder.listen.100.interface: ge*',
                'dns-forwarder.listen.200.interface: ipsec*',
                'dns-forwarder.listen.300.interface: tunnel*',
                'dns-forwarder.listen.400.interface: bridge*',
                'dns-forwarder.listen.500.interface: vlan*',
                'dns-forwarder.listen.600.interface: pppac*',
                'dns-forwarder.service: enable',
        ]);
    });

    it('aaaa-filter is not supported', () => {
        assert_conversions('dns forwarder aaaa-filter enable', convs => {
            assert.equal(convs[0].errors[0].type, 'notsupported');
        });
    });

    it('accept-from-wan is deprecated', () => {
        assert_conversions('dns forwarder accept-from-wan enable', convs => {
            assert.equal(convs[0].errors[0].type, 'deprecated');
        });
    });

    it('disable', () => {
        assertconv([
            'dns forwarder disable',
        ], [
                'dns-forwarder.service: disable',
        ]);
    });

    it('"ipcp-auto" is converted to "ipcp"', () => {
        assertconv([
            'dns forwarder enable',
            'dns forwarder add ipcp-auto',
        ], [
            'dns-forwarder.100.address: ipcp',
            'dns-forwarder.listen.100.interface: ge*',
            'dns-forwarder.listen.200.interface: ipsec*',
            'dns-forwarder.listen.300.interface: tunnel*',
            'dns-forwarder.listen.400.interface: bridge*',
            'dns-forwarder.listen.500.interface: vlan*',
            'dns-forwarder.listen.600.interface: pppac*',
            'dns-forwarder.service: enable',
        ]);
    });

    it('query-translation is not supported', () => {
        assert_conversions('dns forwarder query-translation enable', convs => {
            assert.equal(convs[0].errors[0].type, 'notsupported');
        });
    });
});

describe('encrypted-password-long', () => {
    it('can convert admin password', () => {
        assertconv([
            'encrypted-password-long admin $2a$07$YDRU02fiS6Fy7sr1TcIBkuOFqA/mQaTYmgza4m5QppasE8RIUpZ/m',
        ], [
            'login.admin.encrypted-password: $2a$07$YDRU02fiS6Fy7sr1TcIBkuOFqA/mQaTYmgza4m5QppasE8RIUpZ/m',
        ]);
    });

    it('does not support "user" account', () => {
        const c = new s2r.Converter('encrypted-password-long user foo');
        const e = c.conversions[0].errors[0]
        assert.strictEqual(e.type, 'notsupported');
    });
});

describe('environment', () => {
    it('login-timer', () => {
        assertconv('environment login-timer 123', 'terminal.login-timer: 123');
    });
    it('pager', () => {
        assertconv('environment pager off', 'terminal.pager: disable');
    });
    it('terminal is deprecated', () => {
        assert_conversions('environment terminal auto-size on', convs => {
            assert.equal(convs[0].errors[0].type, 'deprecated');
        });
    });
});

describe('filter', () => {
    it('parameters', () => {
        assertconv([
            'filter add FOO interface lan1 label "LAB" direction in action pass protocol tcpudp ' +
            'src 10.0.0.1/32 srcport 1111 dst 10.0.0.2/32 dstport 2222 ipopts any ' +
            'keepalive 10.0.0.3 state enable state-ttl 123 logging state-only'
        ], [
            'filter.ipv4.100.interface: ge0',
            'filter.ipv4.100.label: LAB',
            'filter.ipv4.100.direction: in',
            'filter.ipv4.100.action: pass',
            'filter.ipv4.100.protocol: tcpudp',
            'filter.ipv4.100.source.address: 10.0.0.1/32',
            'filter.ipv4.100.source.port: 1111',
            'filter.ipv4.100.destination.address: 10.0.0.2/32',
            'filter.ipv4.100.destination.port: 2222',
            'filter.ipv4.100.ipopts: any',
            'filter.ipv4.100.keepalive: 10.0.0.3',
            'filter.ipv4.100.state: enable',
            'filter.ipv4.100.state.ttl: 123',
            'filter.ipv4.100.logging: state-only',
        ]);
    });

    it('application parameter is deprecated', () => {
        assert_conversions('filter add FOO interface vlan0 direction in action pass application winny', convs => {
            assert.equal(convs[0].errors[0].type, 'deprecated');
        });
    });

    it('action forward', () => {
        assertconv([
            'filter add FOO interface vlan0 direction in action forward 192.168.0.1',
        ], [
            'filter.forward.ipv4.100.label: FOO',
            'filter.forward.ipv4.100.interface: vlan0',
            'filter.forward.ipv4.100.direction: in',
            'filter.forward.ipv4.100.gateway: 192.168.0.1',
        ]);
    });

    it('"direction out" implies "interface any"', () => {
        assertconv(`
            filter add FOO direction out action forward 192.168.0.1
            ---
            filter.forward.ipv4.100.label: FOO
            filter.forward.ipv4.100.direction: out
            filter.forward.ipv4.100.interface: any
            filter.forward.ipv4.100.gateway: 192.168.0.1
        `);
    });

    it('direction in/out -> inout', () => {
        assertconv([
            'filter add FOO interface vlan0 direction in/out action pass state disable logging on enable',
        ], [
            'filter.ipv4.100.label: FOO',
            'filter.ipv4.100.action: pass',
            'filter.ipv4.100.direction: inout',
            'filter.ipv4.100.interface: vlan0',
            'filter.ipv4.100.logging: on',
            'filter.ipv4.100.state: disable'
        ]);
    });

    it('srcport/dstport implies protocol tcpudp (if not specified)', () => {
        assertconv(`
            filter add A interface lan1 direction in action pass srcport 1
            ---
            filter.ipv4.100.label: A
            filter.ipv4.100.action: pass
            filter.ipv4.100.interface: ge0
            filter.ipv4.100.direction: in
            filter.ipv4.100.source.port: 1
            filter.ipv4.100.protocol: tcpudp
        `);
    });
});

describe('filter6', () => {
    it('filter6', () => {
        assertconv([
            'filter6 add FOO interface vlan0 direction in/out action pass',
        ], [
            'filter.ipv6.100.label: FOO',
            'filter.ipv6.100.action: pass',
            'filter.ipv6.100.direction: inout',
            'filter.ipv6.100.interface: vlan0',
        ]);
    });

    it('parameters', () => {
        assertconv([
            'filter6 add FOO interface lan1 label "LAB" direction in action pass protocol tcpudp ' +
            'src 1::1/128 srcport 1111 dst 1::2/128 dstport 2222 exthdr any ' +
            'state enable state-ttl 123 logging state-only'
        ], [
            'filter.ipv6.100.interface: ge0',
            'filter.ipv6.100.label: LAB',
            'filter.ipv6.100.direction: in',
            'filter.ipv6.100.action: pass',
            'filter.ipv6.100.protocol: tcpudp',
            'filter.ipv6.100.source.address: 1::1/128',
            'filter.ipv6.100.source.port: 1111',
            'filter.ipv6.100.destination.address: 1::2/128',
            'filter.ipv6.100.destination.port: 2222',
            'filter.ipv6.100.exthdr: any',
            'filter.ipv6.100.state: enable',
            'filter.ipv6.100.state.ttl: 123',
            'filter.ipv6.100.logging: state-only',
        ]);
    });

    it('policy routing (action forward)', () => {
        assertconv(`
            filter6 add FOO interface vlan0 direction out action forward 1::1
            ---
            filter.forward.ipv6.100.label: FOO
            filter.forward.ipv6.100.direction: out
            filter.forward.ipv6.100.gateway: 1::1
            filter.forward.ipv6.100.interface: vlan0
        `);
    });

    it('srcport/dstport implies protocol tcpudp (if not specified)', () => {
        assertconv(`
            filter6 add A interface lan1 direction in action pass dstport 1
            ---
            filter.ipv6.100.label: A
            filter.ipv6.100.action: pass
            filter.ipv6.100.interface: ge0
            filter.ipv6.100.direction: in
            filter.ipv6.100.destination.port: 1
            filter.ipv6.100.protocol: tcpudp
        `);
    });
});

describe('floatlink', () => {
    it('ike proposal', () => {
        assertconv('floatlink ike proposal dh-group modp2048',
            'floatlink.ike.proposal.phase1.dh-group: modp2048');
        assertconv('floatlink ike proposal encryption aes128,3des',
            [
                'floatlink.ike.proposal.phase1.encryption.100.algorithm: aes128',
                'floatlink.ike.proposal.phase1.encryption.200.algorithm: 3des'
            ]);
        assertconv('floatlink ike proposal hash sha256,sha1',
            [
                'floatlink.ike.proposal.phase1.hash.100.algorithm: sha256',
                'floatlink.ike.proposal.phase1.hash.200.algorithm: sha1'
            ]);
        assertconv('floatlink ike proposal lifetime-of-time 12345',
            'floatlink.ike.proposal.phase1.lifetime: 12345');

    });

    it('ipsec proposal', () => {
        assertconv('floatlink ipsec proposal authentication-algorithm hmac-sha256,hmac-sha1',
            [
                'floatlink.ike.proposal.phase2.authentication.100.algorithm: hmac-sha256',
                'floatlink.ike.proposal.phase2.authentication.200.algorithm: hmac-sha1'
            ]);
        assertconv('floatlink ipsec proposal encryption-algorithm aes192,des',
            [
                'floatlink.ike.proposal.phase2.encryption.100.algorithm: aes192',
                'floatlink.ike.proposal.phase2.encryption.200.algorithm: des'
            ]);
        assertconv('floatlink ipsec proposal lifetime-of-time 23456',
            'floatlink.ike.proposal.phase2.lifetime-of-time: 23456');
        assertconv('floatlink ipsec proposal pfs-group modp3072',
            'floatlink.ike.proposal.phase2.pfs-group: modp3072');
    });
});

describe('hostname', () => {
    it('simple hostname', () => {
        assertconv('hostname foo', 'hostname: foo');
    });

    it('quotation', () => {
        // hostname "<'\" \\>" -> hostname: "<'\" \\>"
        assertconv('hostname "<\'\\" \\\\>"', 'hostname: "<\'\\" \\\\>"');
    });
});

describe('httpd', () => {
    it('is not supported', () => {
        assert_conversions('httpd enable', convs => {
            assert(convs[0].errors[0].type == 'notsupported');
        });
    });

    it('is ignored if it is disabled', () => {
        assertconv('httpd disable', '');
    });
});

describe('ike', () => {
    it('global parameters', () => {
        assertconv(`
            ike auto-initiation disable
            ike dpd-interval 43
            ike dpd-maxfail 6
            ike exclusive-tail disable
            ike interval 40s
            ike maximum-padding-length 21
            ike nat-keepalive-interval 121
            ike per-send 2
            ike phase1-timeout 41s
            ike phase2-timeout 42s
            ike randomize-padding-length enable
            ike randomize-padding-value disable
            ike retry 6
            ike strict-padding-byte-check enable
            ---
            ike.auto-initiation: disable
            ike.dpd-maxfail: 6
            ike.dpd-interval: 43
            ike.exclusive-tail: disable
            ike.interval: 40
            ike.maximum-padding-length: 21
            ike.nat-keepalive-interval: 121
            ike.per-send: 2
            ike.phase1-timeout: 41s
            ike.phase2-timeout: 42s
            ike.randomize-padding-length: enable
            ike.randomize-padding-value: disable
            ike.retry: 6
            ike.strict-padding-byte-check: enable
        `);
    });
});

describe('interface', () => {
    it('can change mtu', () => {
        assertconv('interface ipsec0 mtu 1234', 'interface.ipsec0.mtu: 1234');
    });

    it('has a description', () => {
        assertconv('interface lan1 description "IIJmio Hikari"',
         'interface.ge0.description: "IIJmio Hikari"');
    });

    it('can change tcp-mss / tcp-mss6', () => {
        assertconv(`
            interface ge0 tcp-mss 1400
            interface ge0 tcp-mss6 1380
            ---
            interface.ge0.ipv4.tcp-mss: 1400
            interface.ge0.ipv6.tcp-mss: 1380
        `);
    });


    // ルーティングベース IPsec 全体のテストは 'ipsec' の方に書く。
    it('ipsec0 unnumbered', () => {
        assertconv([
            'interface ipsec0 tunnel 10.0.0.1 10.0.0.2',
            'interface ipsec0 unnumbered',
        ], [
            'interface.ipsec0.ipv4.address: ge1',
            'interface.ipsec0.ipv4.destination: 10.0.0.2',
            'interface.ipsec0.ipv4.source: 10.0.0.1',
        ]);
    });

    it('ipsec0 unnumbered on lan2', () => {
        assertconv([
            'interface ipsec0 tunnel 10.0.0.1 10.0.0.2',
            'interface ipsec0 unnumbered on lan2',
        ], [
            'interface.ipsec0.ipv4.address: ge2',
            'interface.ipsec0.ipv4.destination: 10.0.0.2',
            'interface.ipsec0.ipv4.source: 10.0.0.1',
        ]);
    });

    it('ipsec0 floatlink', () => {
        assertconv([
            'interface ipsec0 floatlink my-node-id MY-NODE-ID',
            'interface ipsec0 floatlink peer-node-id PEER-NODE-ID',
            'interface ipsec0 floatlink floatlink-key FLOATLINK-KEY-X',
            'interface ipsec0 floatlink preshared-key PRESHARED-KEY-X',
            'interface ipsec0 floatlink address-family ipv6',
            'interface ipsec0 floatlink nat-traversal force',
            'interface ipsec0 floatlink my-address lan1',
            'floatlink name-service add https://example.jp/floatlink',
        ], [
            'interface.ipsec0.floatlink.name-service: https://example.jp/floatlink',
            'interface.ipsec0.floatlink.my-node-id: MY-NODE-ID',
            'interface.ipsec0.floatlink.peer-node-id: PEER-NODE-ID',
            'interface.ipsec0.floatlink.key: FLOATLINK-KEY-X',
            'interface.ipsec0.preshared-key: PRESHARED-KEY-X',
            'interface.ipsec0.floatlink.address-family: ipv6',
            'interface.ipsec0.nat-traversal: force',
            'interface.ipsec0.floatlink.my-address: ge0',
        ]);

    });

    // l2tp interface -> look for "describe('l2tp', ...)

    describe('pppoe', () => {
        it('all ppp parameters', () => {
            assertconv(`
                ppp add PPP ipcp enable ipv6cp enable keepalive 30 ipcp-address on ipcp-dns on authentication-method auto identifier user@example.jp passphrase PASS tcp-mss 1404 tcp-mss6 1406
                interface pppoe0 ppp-configuration PPP
                interface pppoe0 over lan1
                ---
                interface.pppoe0.id: user@example.jp
                interface.pppoe0.ipcp: enable
                interface.pppoe0.ipcp.address: enable
                interface.pppoe0.ipcp.dns: enable
                interface.pppoe0.ipv4.tcp-mss: 1404
                interface.pppoe0.ipv6.tcp-mss: 1406
                interface.pppoe0.ipv6cp: enable
                interface.pppoe0.keepalive: 30
                interface.pppoe0.password: PASS
            `);
        });

        it('supports PPPoE over any ge interfaces', () => {
            assertconv([
                'interface pppoe0 over lan0',
            ], [
                'interface.pppoe0.over: ge1',
            ]);
        });
    });

    it('tunnel dslite', () => {
        assertconv([
            'interface tunnel0 tunnel dslite aftr.example.jp',
            'interface tunnel0 unnumbered',
        ], [
            'interface.tunnel0.ipv4.address: ge1',
            'interface.tunnel0.ipv6.dslite.aftr: aftr.example.jp',
        ]);
    });

    it('vlan', () => {
        assertconv([
            'interface vlan0 tag 3',
        ], [
            'interface.vlan0.vid: 3',
            'interface.vlan0.over: ge1',
        ]);
    });
});

describe('ipsec', () => {
    it('mimimal routing-based ipsec', () => {
        assertconv(`
            interface ipsec0 tunnel 10.0.0.1 10.0.0.2
            ike preshared-key add "10.0.0.2" "hogehogehoge"
            ike proposal add IKEP encryption aes128 hash sha256 authentication preshared-key dh-group modp1536
            ike peer add IKEPEER address 10.0.0.2 exchange-mode main proposals IKEP tunnel-interface enable
            ipsec security-association proposal add SAP authentication-algorithm hmac-sha1 encryption-algorithm aes256
            ipsec security-association add SA tunnel-interface ipsec0 ike SAP esp enable
            ---
            interface.ipsec0.ipv4.source: 10.0.0.1
            interface.ipsec0.ipv4.destination: 10.0.0.2
            interface.ipsec0.ipv6.forward: pass
            interface.ipsec0.preshared-key: hogehogehoge
            interface.ipsec0.ike.check-level: strict
            interface.ipsec0.ike.proposal.phase1.encryption.100.algorithm: aes128
            interface.ipsec0.ike.proposal.phase1.hash.100.algorithm: sha256
            interface.ipsec0.ike.proposal.phase1.dh-group: modp1536
            interface.ipsec0.ike.proposal.phase1.lifetime: 8h
            interface.ipsec0.ike.proposal.phase2.authentication.100.algorithm: hmac-sha1
            interface.ipsec0.ike.proposal.phase2.encryption.100.algorithm: aes256
        `);
    });

    it('more routing-based ipsec', () => {
        assertconv(`
            interface ipsec0 tunnel 10.0.0.1 10.0.0.2
            ike preshared-key add "10.0.0.2" "two"
            ike proposal add IKEP encryption aes128,3des hash sha256,md5 authentication preshared-key dh-group modp1536 lifetime-of-time 24h
            ike peer add TWO address 10.0.0.2 exchange-mode main proposals IKEP my-identifier address peers-identifier address initial-contact enable tunnel-interface enable
            ipsec security-association proposal add SAP authentication-algorithm hmac-sha1 encryption-algorithm aes256 lifetime-of-time 8h
            ipsec security-association add SA tunnel-interface ipsec0 ike SAP esp enable
            ----
            interface.ipsec0.ipv4.source: 10.0.0.1
            interface.ipsec0.ipv4.destination: 10.0.0.2
            interface.ipsec0.ipv6.forward: pass
            interface.ipsec0.preshared-key: two
            interface.ipsec0.ike.initial-contact: enable
            interface.ipsec0.ike.proposal.phase1.dh-group: modp1536
            interface.ipsec0.ike.check-level: strict
            interface.ipsec0.ike.my-identifier.type: address
            interface.ipsec0.ike.peers-identifier.type: address
            interface.ipsec0.ike.proposal.phase1.encryption.100.algorithm: aes128
            interface.ipsec0.ike.proposal.phase1.encryption.200.algorithm: 3des
            interface.ipsec0.ike.proposal.phase1.hash.100.algorithm: sha256
            interface.ipsec0.ike.proposal.phase1.hash.200.algorithm: md5
            interface.ipsec0.ike.proposal.phase1.lifetime: 24h
            interface.ipsec0.ike.proposal.phase2.authentication.100.algorithm: hmac-sha1
            interface.ipsec0.ike.proposal.phase2.encryption.100.algorithm: aes256
            interface.ipsec0.ike.proposal.phase2.lifetime-of-time: 8h
        `);
    });

    it('a typical policy-based ipsec', () => {
        assertconv(`
            ike preshared-key add "10.0.0.2" "two"
            ike proposal add IKEP encryption 3des hash sha1 authentication preshared-key dh-group modp1024 lifetime-of-time 08h
            ike peer add TWO address 10.0.0.2 exchange-mode aggressive proposals IKEP my-identifier fqdn TWO
            ipsec security-association proposal add SAP authentication-algorithm hmac-sha1 encryption-algorithm 3des lifetime-of-time 03h pfs-group modp1024
            ipsec security-association add SA tunnel pppoe0 10.0.0.2 ike SAP esp enable
            ipsec security-policy add SP security-association SA src 172.16.0.1/32 dst 172.16.0.2/32
            ----
            ike.peer.100.address: 10.0.0.2
            ike.peer.100.check-level: strict
            ike.peer.100.exchange-mode: aggressive
            ike.peer.100.my-identifier.type: fqdn
            ike.peer.100.my-identifier.fqdn: TWO
            ike.peer.100.nat-traversal: disable
            ike.peer.100.preshared-key: two
            ike.peer.100.proposal.dh-group: modp1024
            ike.peer.100.proposal.encryption.100.algorithm: 3des
            ike.peer.100.proposal.hash.100.algorithm: sha1
            ike.peer.100.proposal.lifetime: 08h
            ipsec.security-association.sa0.address-type: static
            ipsec.security-association.sa0.local-address: pppoe0
            ipsec.security-association.sa0.remote-address: 10.0.0.2
            ipsec.security-policy.100.destination.address: 172.16.0.2/32
            ipsec.security-policy.100.ike.proposal.authentication.100.algorithm: hmac-sha1
            ipsec.security-policy.100.ike.proposal.encryption.100.algorithm: 3des
            ipsec.security-policy.100.ike.proposal.lifetime-of-time: 03h
            ipsec.security-policy.100.ike.proposal.pfs-group: modp1024
            ipsec.security-policy.100.security-association: sa0
            ipsec.security-policy.100.source.address: 172.16.0.1/32
        `);
    });

    it('policy parameters', () => {
        assertconv(`
            ike preshared-key add "two@example.jp" "two"
            ike proposal add IKEP encryption 3des hash sha1 authentication preshared-key dh-group modp1024 lifetime-of-time 08h
            ike peer add TWO exchange-mode aggressive proposals IKEP address 10.0.0.2 check-level claim initial-contact enable my-identifier fqdn ONE peers-identifier user-fqdn two@example.jp nonce-size 32 dpd enable nat-traversal force responder-only on prefer-new-phase1 enable
            ipsec security-association proposal add SAP authentication-algorithm hmac-sha256,hmac-sha1 encryption-algorithm aes256,aes128,3des
            ipsec security-association add SA tunnel 10.0.0.1 10.0.0.2 ike SAP esp enable
            ipsec security-policy add A security-association SA protocol udp src 172.16.0.1/32 srcport 1234 dst 172.16.0.2/32 dstport 4321
            ----
            ike.peer.100.address: 10.0.0.2
            ike.peer.100.check-level: claim
            ike.peer.100.dpd: enable
            ike.peer.100.exchange-mode: aggressive
            ike.peer.100.initial-contact: enable
            ike.peer.100.my-identifier.type: fqdn
            ike.peer.100.my-identifier.fqdn: ONE
            ike.peer.100.nat-traversal: force
            ike.peer.100.nonce-size: 32
            ike.peer.100.peers-identifier.type: user-fqdn
            ike.peer.100.peers-identifier.user-fqdn: two@example.jp
            ike.peer.100.preshared-key: two
            ike.peer.100.proposal.dh-group: modp1024
            ike.peer.100.proposal.encryption.100.algorithm: 3des
            ike.peer.100.proposal.hash.100.algorithm: sha1
            ike.peer.100.proposal.lifetime: 08h
            ike.peer.100.responder-only: enable
            ike.peer.100.prefer-new-phase1: enable
            ipsec.security-association.sa0.address-type: static
            ipsec.security-association.sa0.local-address: 10.0.0.1
            ipsec.security-association.sa0.remote-address: 10.0.0.2
            ipsec.security-policy.100.destination.address: 172.16.0.2/32
            ipsec.security-policy.100.destination.port: 4321
            ipsec.security-policy.100.ike.proposal.authentication.100.algorithm: hmac-sha256
            ipsec.security-policy.100.ike.proposal.authentication.200.algorithm: hmac-sha1
            ipsec.security-policy.100.ike.proposal.encryption.100.algorithm: aes256
            ipsec.security-policy.100.ike.proposal.encryption.200.algorithm: aes128
            ipsec.security-policy.100.ike.proposal.encryption.300.algorithm: 3des
            ipsec.security-policy.100.protocol: udp
            ipsec.security-policy.100.security-association: sa0
            ipsec.security-policy.100.source.address: 172.16.0.1/32
            ipsec.security-policy.100.source.port: 1234
        `);
    });

    it('dynamic', () => {
        assertconv(`
            ike preshared-key add "three.example.jp" "opensesame"
            ike proposal add IKEP3 encryption aes hash sha1 authentication preshared-key dh-group modp1024
            ike peer add PEER3 address dynamic exchange-mode aggressive proposals IKEP3 peers-identifier fqdn "three.example.jp"
            ipsec security-association proposal add SAP3 pfs-group modp1024 authentication-algorithm hmac-sha384 encryption-algorithm aes192
            ipsec security-association add SA3 tunnel dynamic ike SAP3 esp enable
            ipsec security-policy add A security-association SA3 src 172.16.1.0/24 dst 172.16.2.0/24
            ----
            ike.peer.100.preshared-key: opensesame
            ike.peer.100.proposal.encryption.100.algorithm: aes
            ike.peer.100.proposal.hash.100.algorithm: sha1
            ike.peer.100.proposal.dh-group: modp1024
            ike.peer.100.proposal.lifetime: 8h
            ike.peer.100.address: dynamic
            ike.peer.100.exchange-mode: aggressive
            ike.peer.100.peers-identifier.type: fqdn
            ike.peer.100.peers-identifier.fqdn: three.example.jp
            ike.peer.100.check-level: strict
            ike.peer.100.nat-traversal: disable
            ipsec.security-policy.100.ike.proposal.pfs-group: modp1024
            ipsec.security-policy.100.ike.proposal.authentication.100.algorithm: hmac-sha384
            ipsec.security-policy.100.ike.proposal.encryption.100.algorithm: aes192
            ipsec.security-association.sa0.address-type: dynamic
            ipsec.security-policy.100.security-association: sa0
            ipsec.security-policy.100.source.address: 172.16.1.0/24
            ipsec.security-policy.100.destination.address: 172.16.2.0/24
        `);
    });

    it('L2TPv3 over IPsec', () => {
        assertconv([
            'l2tp hostname sideA',
            'l2tp router-id 10.0.0.1',
            'l2tp add B hostname sideB router-id 10.0.0.2',
            'interface l2tp0 tunnel 10.0.0.1 10.0.0.2',
            'interface l2tp0 l2tp B remote-end-id foo',
            'ike preshared-key add 10.0.0.2 foo',
            'ike proposal add IKEP encryption aes128 hash sha1 dh-group modp1536 auth preshared-key lifetime-of-time 8h',
            'ike peer add B address 10.0.0.2 exchange-mode main proposals IKEP',
            'ipsec security-association proposal add SAP authentication-algorithm hmac-sha1 '
            + 'encryption-algorithm aes128 lifetime-of-time 8h pfs-group modp1536',
            'ipsec security-association add SA transport 10.0.0.1 10.0.0.2 ike SAP esp enable',
            'ipsec security-policy add SP security-association SA protocol 115 src 10.0.0.1/32 dst 10.0.0.2/32',
        ], [
            'interface.l2tp0.ike.proposal.phase1.dh-group: modp1536',
            'interface.l2tp0.ike.proposal.phase1.encryption.100.algorithm: aes128',
            'interface.l2tp0.ike.proposal.phase1.hash.100.algorithm: sha1',
            'interface.l2tp0.ike.proposal.phase1.lifetime: 8h',
            'interface.l2tp0.ike.proposal.phase2.authentication.100.algorithm: hmac-sha1',
            'interface.l2tp0.ike.proposal.phase2.encryption.100.algorithm: aes128',
            'interface.l2tp0.ike.proposal.phase2.lifetime-of-time: 8h',
            'interface.l2tp0.ike.proposal.phase2.pfs-group: modp1536',
            'interface.l2tp0.ipv4.source: 10.0.0.1',
            'interface.l2tp0.ipv4.destination: 10.0.0.2',
            'interface.l2tp0.local-hostname: sideA',
            'interface.l2tp0.remote-hostname: sideB',
            'interface.l2tp0.local-router-id: 10.0.0.1',
            'interface.l2tp0.remote-router-id: 10.0.0.2',
            'interface.l2tp0.remote-end-id: foo',
            'interface.l2tp0.ipsec-preshared-key: foo',
        ]);
    });
});

describe('macfilter', () => {
    it('mac address list on config', () => {
        assertconv([
            'macfilter add CONF action pass src 02:04:06:08:0a:0c on lan0 logging on',
        ], [
                'macfilter.entry.100.action: pass',
                'macfilter.entry.100.address: 02:04:06:08:0a:0c',
                'macfilter.entry.100.interface: ge1',
                'macfilter.entry.100.logging: on',
            ]);
    });

    it('on url', () => {
        assertconv([
            'macfilter add BYURL action block src http://user:pass@127.0.0.1/mac.txt interval 1h',
        ], [
            'macfilter.entry-list.100.action: block',
            'macfilter.entry-list.100.update-interval: 1h',
            'macfilter.entry-list.100.url: http://user:pass@127.0.0.1/mac.txt',
        ]);
    });
});

describe('monitor', () => {
    it('full', () => {
        assertconv(`
            monitor enable
            monitor source add MS1 type ppp-connection interface pppoe0 event enable trigger disconnect,connect
            monitor source add MS2 type ppp-connection interface ppp0 event enable trigger disconnect,connect
            monitor source add MS3 type boot-information event enable trigger watchdog-reboot,soft-reboot,power-on-boot
            monitor source add MS4 type usb-port event enable trigger unplug,plug
            monitor source add MS5 type physical-interface-link interface lan0 event enable trigger linkup,linkdown
            monitor source add MS6 type physical-interface-link interface lan1 event enable trigger linkup,linkdown
            monitor source add MS7 type ping target-host 192.168.0.3 source-address 192.168.0.4 description hogehoge down-count 3 watch-interval 15 event enable trigger up,down
            monitor source-group-name add MSG1
            monitor source-group MSG1 source add MS1
            monitor source-group MSG1 source add MS2
            monitor source-group MSG1 source add MS3
            monitor source-group MSG1 source add MS4
            monitor source-group MSG1 source add MS5
            monitor source-group MSG1 source add MS6
            monitor source-group-name add MSG2
            monitor source-group MSG2 source add MS7
            monitor notification-server-group-name add MNSG1
            monitor notification-server-group MNSG1 server add MNS1 protocol snmp-trap-v3 user-name testuser1 destination-address 192.168.0.1 security authpriv authentication-password password1 authentication-method hmac-sha-96 privacy-password password2 privacy-algorithm cfb128-aes-128 port 16201
            monitor notification-server-group MNSG1 server add MNS2 protocol snmp-trap-v3 user-name testuser2 destination-address 2001:db8::1 security authpriv authentication-password password3 authentication-method hmac-sha-96 privacy-password password4 privacy-algorithm cfb128-aes-128 port 16202
            monitor binding add MB1 source-group MSG1 notification-server-group MNSG1
            monitor binding add MB2 source-group MSG2 notification-server-group MNSG1
            ---
            monitor.service: enable
            monitor.physical-interface-link.100.interface: ge1
            monitor.physical-interface-link.100.trigger.100.event: linkup
            monitor.physical-interface-link.100.trigger.200.event: linkdown
            monitor.physical-interface-link.200.interface: ge0
            monitor.physical-interface-link.200.trigger.100.event: linkup
            monitor.physical-interface-link.200.trigger.200.event: linkdown
            monitor.ppp-connection.100.interface: pppoe0
            monitor.ppp-connection.100.trigger.100.event: disconnect
            monitor.ppp-connection.100.trigger.200.event: connect
            monitor.ppp-connection.200.interface: ppp0
            monitor.ppp-connection.200.trigger.100.event: disconnect
            monitor.ppp-connection.200.trigger.200.event: connect
            monitor.usb-port.trigger.100.event: unplug
            monitor.usb-port.trigger.200.event: plug
            monitor.boot-information.trigger.100.event: unknown
            monitor.ping.100.address: 192.168.0.3
            monitor.ping.100.source-address: 192.168.0.4
            monitor.ping.100.description: hogehoge
            monitor.ping.100.down-count: 3
            monitor.ping.100.watch-interval: 15
            monitor.ping.100.trigger.100.event: up
            monitor.ping.100.trigger.200.event: down
            monitor.notification.snmp-trap.100.address: 192.168.0.1
            monitor.notification.snmp-trap.100.port: 16201
            monitor.notification.snmp-trap.100.user-name: testuser1
            monitor.notification.snmp-trap.100.authentication-password: password1
            monitor.notification.snmp-trap.100.privacy-password: password2
            monitor.notification.snmp-trap.200.address: 2001:db8::1
            monitor.notification.snmp-trap.200.port: 16202
            monitor.notification.snmp-trap.200.user-name: testuser2
            monitor.notification.snmp-trap.200.authentication-password: password3
            monitor.notification.snmp-trap.200.privacy-password: password4
        `);
    });
});

describe('nat', () => {
    it('bypass', () => {
        assertconv([
            'nat bypass add 192.168.0.1 198.51.100.1 interface vlan0',
        ], [
                'nat.ipv4.bypass.100.private: 192.168.0.1',
                'nat.ipv4.bypass.100.global: 198.51.100.1',
                'nat.ipv4.bypass.100.interface: vlan0',
            ]);
    });

    it('dynamic', () => {
        assertconv([
            'nat dynamic add global 10.0.0.1',
            'nat dynamic add global 10.0.0.2-10.0.0.3 interface lan1',
            'nat dynamic add private 192.168.0.9 interface lan1',
        ], [
                'nat.ipv4.dnat.100.global.100.address: 10.0.0.1',
                'nat.ipv4.dnat.100.global.200.address: 10.0.0.2-10.0.0.3',
                'nat.ipv4.dnat.100.private.100.address: 192.168.0.9'
            ]);
    });

    it('napt', () => {
        assertconv([
            'nat napt add global 10.0.0.1',
            'nat napt add private 192.168.0.1-192.168.0.255 interface lan1',
        ], [
                'nat.ipv4.napt.global: 10.0.0.1',
                'nat.ipv4.napt.100.interface: ge0',
                'nat.ipv4.napt.100.private: 192.168.0.1-192.168.0.255'
            ]);
    });

    it('reflect', () => {
        assertconv([
            'nat reflect add interface lan0',
        ], [
                'nat.ipv4.reflect.100.interface: ge1',
            ]);
    });

    it('session limit', () => {
        assertconv([
            'nat session restricted-per-ip 123',
            'nat session restricted-per-private-ip 234',
        ], [
                'nat.ipv4.option.limit.session-per-ip: 123',
                'nat.ipv4.option.limit.session-per-private-ip: 234',
            ]);
    });

    it('sip proxy', () => {
        assertconv([
            'nat proxy sip add port 5060 protocol udp',
        ], [
                'nat.proxy.sip.100.protocol: udp',
                'nat.proxy.sip.100.port: 5060',
            ]);
    });

    it('snapt with port', () => {
        assertconv([
            'nat snapt add protocol tcp listen 80-80 forward 192.168.0.1 81-81 enable interface lan1',
            'nat snapt add protocol tcp listen 90-90 forward 192.168.0.2 91-91 disable interface vlan0',
        ], [
                'nat.ipv4.snapt.100.forward.address: 192.168.0.1',
                'nat.ipv4.snapt.100.forward.port: 81-81',
                'nat.ipv4.snapt.100.interface: ge0',
                'nat.ipv4.snapt.100.listen.port: 80-80',
                'nat.ipv4.snapt.100.protocol: tcp'
            ]);

    });

    it('snapt without port', () => {
        assertconv([
            'nat snapt add protocol 41 forward 192.168.0.6 enable interface vlan0',
        ], [
                'nat.ipv4.snapt.100.forward.address: 192.168.0.6',
                'nat.ipv4.snapt.100.interface: vlan0',
                'nat.ipv4.snapt.100.protocol: 41'
            ]);

    });

    it('static', () => {
        assertconv([
            'nat static add 192.168.0.1 198.51.100.1 interface vlan0',
        ], [
                'nat.ipv4.snat.100.private: 192.168.0.1',
                'nat.ipv4.snat.100.global: 198.51.100.1',
                'nat.ipv4.snat.100.interface: vlan0',
            ]);
    });

    it('timeout', () => {
        assertconv([
            'nat timeout 123',
            'nat timeout protocol tcp-synonly 234',
        ], [
                'nat.ipv4.timeout: 123',
                'nat.ipv4.timeout.tcp-synonly: 234',
            ]);
    });

    it('upnp', () => {
        assertconv([
            'nat upnp on',
            'nat upnp interface lan1',
            'nat upnp timeout 1234',
            'nat upnp timeout type arp',
        ], [
                'upnp.service: enable',
                'upnp.interface: ge0',
                'upnp.listen.0.interface: ge1',
                'upnp.timeout: 1234',
                'upnp.timeout-type: arp',
            ]);
    });
});

describe('nat6', () => {
    it('simple', () => {
        assertconv(`
            nat6 add FOO type ngn interface lan0 internal 2001:db8:1::/64 external 2001:db8:2::/64 ndproxy on
            ---
            nat.ipv6.100.type: ngn
            nat.ipv6.100.interface: ge1
            nat.ipv6.100.internal: 2001:db8:1::/64
            nat.ipv6.100.external: 2001:db8:2::/64
            nat.ipv6.100.ndproxy: enable
        `);
    });
});

describe('ntp', () => {
    it('ntp server', () => {
        assertconv([
            'ntp enable',
            'ntp server add 10.0.0.1',
        ], [
                'ntp.service: enable',
                'ntp.server: enable',
                'ntp.client.100.address: 10.0.0.1',
            ]);
    });

    it('ntp client', () => {
        assertconv([
            'ntp enable',
            'ntp mode client',
            'ntp server add 1.1.1.2',
        ], [
                'ntp.service: enable',
                'ntp.server: disable',
                'ntp.client.100.address: 1.1.1.2',
            ]);
    });

    it('accepts compatibility syntax', () => {
        assertconv(`
            ntp enable
            ntp server 10.0.0.1
            ---
            ntp.service: enable
            ntp.server: enable
            ntp.client.100.address: 10.0.0.1
        `);
    });
});

describe('option', () => {
    it('options', () => {
        assertconv(`
            option ip directed-broadcast on
            option ip fragment-requeueing on
            option ip monitor-linkstate on
            option ip redirects off
            option ipv6 fragment-requeueing on
            option ipv6 monitor-linkstate on
            option ipv6 redirects off
            ---
            option.ipv4.directed-broadcast.service: enable
            option.ipv4.fragment-requeueing.service: enable
            option.ipv4.monitor-linkstate.service: enable
            option.ipv4.send-icmp-redirect.service: disable
            option.ipv6.fragment-requeueing.service: enable
            option.ipv6.monitor-linkstate.service: enable
            option.ipv6.send-icmp-redirect.service: disable
        `);
    });

    it('may be omitted from recipe_config part of a test case', () => {
        assertconv(`
            option ip fragment-requeueing off
            option ip monitor-linkstate off
            option ip redirects on
            option ipv6 fragment-requeueing off
            option ipv6 monitor-linkstate off
            option ipv6 redirects on
            ---
        `);
    });
});

describe('pppac', () => {
    it('option', () => {
        assertconv('pppac option session-limit on',
            'option.pppac.session-limit: enable');
    });
});

describe('proxyarp', () => {
    it('proxyarp', () => {
        assertconv([
            'proxyarp enable',
            'proxyarp add FOO interface lan0 address 192.168.0.1 mac-address 02:04:06:08:0a:0c',
        ], [
            'proxyarp.100.interface: ge1',
            'proxyarp.100.ipv4-address: 192.168.0.1',
            'proxyarp.100.mac-address: 02:04:06:08:0a:0c',
        ])

    });
});

describe('resolver', () => {
    it('resolver', () => {
        assertconv([
            'resolver enable',
            'resolver address add ipcp',
            'resolver address add 192.168.0.1',
            'resolver domain example.jp',
            'resolver host-database add a.example.jp address 10.0.0.1,10.0.0.2',
        ], [
              'resolver.100.address: ipcp',
              'resolver.200.address: 192.168.0.1',
              'resolver.domain: example.jp',
              'resolver.host-database.100.address: 10.0.0.1',
              'resolver.host-database.100.hostname: a.example.jp',
              'resolver.host-database.200.address: 10.0.0.2',
              'resolver.host-database.200.hostname: a.example.jp',
              'resolver.service: enable',
        ]);
    });

    it('"ipcp-auto" is converted to "ipcp"', () => {
        assertconv([
            'resolver enable',
            'resolver address add ipcp-auto',
        ], [
            'resolver.100.address: ipcp',
            'resolver.service: enable',
        ]);
    });
});

describe('route', () => {
    it('RIP minimal', () => {
        assertconv(`
        route dynamic rip enable
        route dynamic rip interface lan0 enable
        ---
        rip.interface.100.interface: ge1
        `);
    });

    it('RIP with authenticaiton', () => {
        assertconv([
            'route dynamic auth-key add FOO type plain-text password himitsu',
            'route dynamic rip enable',
            'route dynamic rip update-timer 5',
            'route dynamic rip expire-timer 30',
            'route dynamic rip garbage-collection-timer 20',
            'route dynamic rip interface lan0 enable',
            'route dynamic rip interface lan0 version ripv2',
            'route dynamic rip interface lan0 authentication enable',
            'route dynamic rip interface lan0 authentication auth-key FOO',
        ], [
            'rip.interface.100.authentication.plain-text.password: himitsu',
            'rip.interface.100.authentication.type: plain-text',
            'rip.interface.100.interface: ge1',
            'rip.interface.100.version: ripv2',
            'rip.timer.update: 5',
            'rip.timer.expire: 30',
            'rip.timer.garbage-collection: 20',
        ]);
    });

    it('redistribute with route-filter', () => {
        assertconv([
            'route dynamic route-filter add OSPF network 192.168.0.0/16 interface vlan0 pass set-metric 4',
            'route dynamic ospf enable',
            'route dynamic ospf router-id 192.168.0.1',
            'route dynamic ospf enable',
            'route dynamic ospf area add 0.0.0.0',
            'route dynamic ospf link add lan0 area 0.0.0.0',
            'route dynamic redistribute rip-to-ospf enable metric 30 metric-type 1 route-filter OSPF',
        ], [
            'ospf.router-id: 192.168.0.1',
            'ospf.area.100.id: 0.0.0.0',
            'ospf.link.100.interface: ge1',
            'ospf.link.100.area: 0.0.0.0',
            'ospf.redistribute-from.rip.redistribute: enable',
            'ospf.redistribute-from.rip.set.metric: 30',
            'ospf.redistribute-from.rip.set.metric-type: 1',
            'ospf.redistribute-from.rip.filter.100.action: pass',
            'ospf.redistribute-from.rip.filter.100.match.prefix: 192.168.0.0/16',
            'ospf.redistribute-from.rip.filter.100.match.interface: vlan0',
            'ospf.redistribute-from.rip.filter.100.set.metric: 4',
        ]);
    });

    it('redistribute to ospf without route-filter', () => {
        assertconv([
            'route dynamic auth-key add FOUR type md5 keyid 6 password seven',
            'route dynamic ospf enable',
            'route dynamic ospf router-id 192.168.0.1',
            'route dynamic ospf enable',
            'route dynamic ospf area add 0.0.0.0',
            'route dynamic ospf link add lan0 area 0.0.0.0 authentication auth-key FOUR',
            'route dynamic redistribute static-to-ospf enable metric 123 metric-type 1',
            'route dynamic redistribute rip-to-ospf enable',
        ], [
            'ospf.router-id: 192.168.0.1',
            'ospf.area.100.id: 0.0.0.0',
            'ospf.link.100.interface: ge1',
            'ospf.link.100.area: 0.0.0.0',
            'ospf.link.100.authentication.type: md5',
            'ospf.link.100.authentication.md5.key-id: 6',
            'ospf.link.100.authentication.md5.secret-key: seven',
            'ospf.redistribute-from.static.redistribute: enable',
            'ospf.redistribute-from.static.set.metric-type: 1',
            'ospf.redistribute-from.static.set.metric: 123',
            'ospf.redistribute-from.rip.redistribute: enable',
        ]);
    });

    describe('OSPF', () => {
        it('should generate no ospf lines if ospf is disabled', () => {
            assertconv([
                'route dynamic ospf router-id 192.168.0.1',
                'route dynamic ospf disable',
                'route dynamic ospf area add 0.0.0.0',
                'route dynamic ospf link add lan0 area 0.0.0.0',
                'route dynamic redistribute connected-to-ospf enable',
                'route dynamic redistribute static-to-ospf enable',
                'route dynamic redistribute rip-to-ospf enable',
                'route dynamic redistribute bgp-to-ospf enable',
            ], []);
        });
    });

    describe('BGP', () => {
        it('minimal', () => {
            assertconv([
                'route dynamic bgp my-as-number 65001',
                'route dynamic bgp router-id 192.168.0.1',
                'route dynamic bgp enable',
                'route dynamic bgp neighbor add 192.168.0.2 remote-as 65002 enable'
            ], [
                "bgp.my-as-number: 65001",
                "bgp.router-id: 192.168.0.1",
                "bgp.neighbor.100.address: 192.168.0.2",
                "bgp.neighbor.100.remote-as: 65002"
            ]);
        });

        it('can prepend AS-path to routes from neighbors', () => {
            assertconv([
                'route dynamic route-filter add ASPATH network 10.0.0.0/8 pass set-as-path-prepend 65009,65008',
                'route dynamic bgp my-as-number 65001',
                'route dynamic bgp router-id 192.168.0.1',
                'route dynamic bgp enable',
                'route dynamic bgp neighbor add 192.168.0.2 remote-as 65002 in-route-filter ASPATH',
            ], [
                "bgp.neighbor.100.address: 192.168.0.2",
                "bgp.neighbor.100.filter.in.100.action: pass",
                "bgp.neighbor.100.filter.in.100.match.prefix: 10.0.0.0/8",
                "bgp.neighbor.100.filter.in.100.set.as-path-prepend: \"65009 65008\"",
                "bgp.neighbor.100.remote-as: 65002",
                "bgp.my-as-number: 65001",
                "bgp.router-id: 192.168.0.1"
            ]);
        });

        it('can import redistributed routes', () => {
            assertconv([
                'route dynamic route-filter add A network 10.0.0.0/8 interface lan0 '
                + 'pass set-metric 2 set-weight 3 set-as-path-prepend 4',
                'route dynamic bgp my-as-number 65001',
                'route dynamic bgp router-id 192.168.0.1',
                'route dynamic bgp enable',
                'route dynamic bgp neighbor add 192.168.0.2 remote-as 65002',
                'route dynamic redistribute rip-to-bgp enable metric 5 route-filter A',
            ], [
                "bgp.ipv4.redistribute-from.rip.redistribute: enable",
                "bgp.ipv4.redistribute-from.rip.set.metric: 5",
                "bgp.ipv4.redistribute-from.rip.filter.100.action: pass",
                "bgp.ipv4.redistribute-from.rip.filter.100.match.prefix: 10.0.0.0/8",
                "bgp.ipv4.redistribute-from.rip.filter.100.match.interface: ge1",
                "bgp.ipv4.redistribute-from.rip.filter.100.set.as-path-prepend: 4",
                "bgp.ipv4.redistribute-from.rip.filter.100.set.metric: 2",
                "bgp.ipv4.redistribute-from.rip.filter.100.set.weight: 3",
                "bgp.neighbor.100.address: 192.168.0.2",
                "bgp.neighbor.100.remote-as: 65002",
                "bgp.my-as-number: 65001",
                "bgp.router-id: 192.168.0.1"
            ]);
        });
    });
});

describe('route6', () => {
    it('static routes', () => {
        assertconv([
            'route6 add default router-advertisement interface lan2 distance 3',
        ], [
                'route.ipv6.100.destination: default',
                'route.ipv6.100.gateway: router-advertisement',
                'route.ipv6.100.router-advertisement-interface: ge2',
                'route.ipv6.100.distance: 3',
            ]);
    });
});

describe('route6 dynamic ospf', () => {
    it('minimal', () => {
        assertconv([
            'route6 dynamic ospf router-id 192.168.0.1',
            'route6 dynamic ospf enable',
            'route6 dynamic ospf area add 0.0.0.0',
            'route6 dynamic ospf link add lan0 area 0.0.0.0',
        ], [
            "ospf6.area.100.id: 0.0.0.0",
            "ospf6.link.100.area: 0.0.0.0",
            "ospf6.link.100.interface: ge1",
            "ospf6.router-id: 192.168.0.1",
        ]);
    });

    it('full', () => {
        assertconv([
            'route6 dynamic ospf router-id 192.168.0.1',
            'route6 dynamic ospf enable',
            'route6 dynamic ospf area add 0.0.0.0',
            'route6 dynamic ospf area add 0.0.0.1 range 1::/16',
            'route6 dynamic ospf link add lan0 area 0.0.0.0 cost 2 hello-interval 3 '
            + 'dead-interval 4 retransmit-interval 5 transmit-delay 6 priority 7 instance-id 8 '
            + 'passive-interface off',
        ], [
            "ospf6.area.100.id: 0.0.0.0",
            "ospf6.area.200.id: 0.0.0.1",
            "ospf6.area.200.range.0.prefix: 1::/16",
            "ospf6.link.100.area: 0.0.0.0",
            "ospf6.link.100.cost: 2",
            "ospf6.link.100.dead-interval: 4",
            "ospf6.link.100.hello-interval: 3",
            "ospf6.link.100.instance-id: 8",
            "ospf6.link.100.interface: ge1",
            "ospf6.link.100.passive-interface: disable",
            "ospf6.link.100.priority: 7",
            "ospf6.link.100.retransmit-interval: 5",
            "ospf6.link.100.transmit-delay: 6",
            "ospf6.router-id: 192.168.0.1",
        ]);
    });

    it('is disabled', () => {
        assertconv('route6 dynamic ospf disable', '');
    });

    it('is redistributed from...', () => {
        assertconv([
            'route6 dynamic ospf router-id 192.168.0.1',
            'route6 dynamic ospf enable',
            'route6 dynamic redistribute connected-to-ospf enable',
            'route6 dynamic redistribute ripng-to-ospf enable metric 2',
            'route6 dynamic redistribute static-to-ospf enable metric 3 metric-type 2',
        ], [
            "ospf6.redistribute-from.connected.redistribute: enable",
            "ospf6.redistribute-from.ripng.redistribute: enable",
            "ospf6.redistribute-from.ripng.set.metric: 2",
            "ospf6.redistribute-from.static.redistribute: enable",
            "ospf6.redistribute-from.static.set.metric: 3",
            "ospf6.redistribute-from.static.set.metric-type: 2",
            "ospf6.router-id: 192.168.0.1",
        ]);
    });
});

describe('route6 dynamic ripng', () => {
    it('minimal', () => {
        assertconv([
            'route6 dynamic ripng enable',
            "route6 dynamic ripng interface lan0 enable",
        ], [
            "ripng.interface.100.interface: ge1",
        ]);
    });

    it('full', () => {
        assertconv([
            "route6 dynamic route-filter add RIPNG network 1::/32 metric 2 pass set-metric 3",
            "route6 dynamic ripng enable",
            "route6 dynamic ripng interface lan0 enable supply-only",
            "route6 dynamic ripng interface lan0 aggregate add 1::/16 metric 2",
            "route6 dynamic ripng interface lan0 route-filter out RIPNG",
            "route6 dynamic ripng interface vlan0 enable listen-only",
            "route6 dynamic ripng default-route-originate enable",
        ], [
            "ripng.default-route-originate.originate: enable",
            "ripng.interface.100.aggregate.100.metric: 2",
            "ripng.interface.100.aggregate.100.prefix: 1::/16",
            "ripng.interface.100.filter.out.100.action: pass",
            "ripng.interface.100.filter.out.100.match.prefix: 1::/32",
            "ripng.interface.100.filter.out.100.set.metric: 3",
            "ripng.interface.100.interface: ge1",
            "ripng.interface.100.mode: supply-only",
            "ripng.interface.200.interface: vlan0",
            "ripng.interface.200.mode: listen-only",
        ])
    });

    it('is disabled', () => {
        assertconv('route6 dynamic ripng disable', '');
    });

    it('is redistributed from...', () => {
        assertconv([
            'route6 dynamic ripng enable',
            'route6 dynamic redistribute connected-to-ripng enable',
            'route6 dynamic redistribute ospf-to-ripng enable',
            'route6 dynamic redistribute static-to-ripng enable metric 2',
        ], [
            "ripng.redistribute-from.connected.redistribute: enable",
            "ripng.redistribute-from.ospf6.redistribute: enable",
            "ripng.redistribute-from.static.redistribute: enable",
            "ripng.redistribute-from.static.set.metric: 2",
        ]);
    });
});

describe('rtadvd', () => {
    it('rtadvd', () => {
        assertconv([
            'rtadvd enable',
            'rtadvd interface lan0 enable',
            'rtadvd interface lan0 advertise manual',
            'rtadvd interface lan0 advertise add interface-prefix valid-lifetime 20 preferred-lifetime 10 onlink-flag off autonomous-flag off',
        ], [
                'router-advertisement.service: enable',
                'router-advertisement.100.interface: ge1',
                'router-advertisement.100.advertise.100.prefix: auto',
                'router-advertisement.100.advertise.100.preferred-lifetime: 10',
                'router-advertisement.100.advertise.100.valid-lifetime: 20',
                'router-advertisement.100.advertise.100.autonomous-flag: disable',
                'router-advertisement.100.advertise.100.onlink-flag: disable',
            ]);
    });

    it('per-interface parameters', () => {
        assertconv(`
            rtadvd enable
            rtadvd interface lan0 enable
            rtadvd interface lan0 curhoplimit 1
            rtadvd interface lan0 managed-flag on
            rtadvd interface lan0 max-interval 30
            rtadvd interface lan0 min-interval 10
            rtadvd interface lan0 mtu 1420
            rtadvd interface lan0 other-flag on
            rtadvd interface lan0 reachable-time 123
            rtadvd interface lan0 retransmit-timer 234
            rtadvd interface lan0 router-lifetime 345
            ---
            router-advertisement.service: enable
            router-advertisement.100.interface: ge1
            router-advertisement.100.curhoplimit: 1
            router-advertisement.100.managed-flag: enable
            router-advertisement.100.max-interval: 30
            router-advertisement.100.min-interval: 10
            router-advertisement.100.mtu: 1420
            router-advertisement.100.other-flag: enable
            router-advertisement.100.reachable-time: 123
            router-advertisement.100.retrans-timer: 234
            router-advertisement.100.router-lifetime: 345
        `);
    });
});

describe('snmp', () => {
    it('snmp basic configuration', () => {
        assertconv([
            'snmp enable',
            'snmp community HIMITSU',
            'snmp sysname SEIL/X4',
            'snmp trap enable',
            'snmp trap add 10.0.0.1',
            'snmp trap add 10.0.0.2',
            'snmp trap watch add 10.0.0.3 errors 4 interval 5 interval-fail 6',
            'snmp trap watch add 10.0.0.4',
            'snmp trap src 10.0.0.5',
        ], [
            'snmp.service: enable',
            'snmp.community: HIMITSU',
            'snmp.sysname: SEIL/X4',
            'snmp.trap.agent-address: 10.0.0.5',
            'snmp.trap.service: enable',
            'snmp.trap.host.100.address: 10.0.0.1',
            'snmp.trap.host.200.address: 10.0.0.2',
            'snmp.trap.watch.100.address: 10.0.0.3',
            'snmp.trap.watch.100.errors: 4',
            'snmp.trap.watch.100.interval: 5',
            'snmp.trap.watch.100.interval-fail: 6',
            'snmp.trap.watch.100.trap-index: 1',
            'snmp.trap.watch.200.address: 10.0.0.4',
            'snmp.trap.watch.200.trap-index: 2',
        ]);
    });
});

describe('sshd', () => {
    it('password-authentication system-default, sshd enable', () => {
        assertconv([
            'sshd enable',
        ], [
                'sshd.password-authentication: enable',
                'sshd.service: enable',
            ]);
    });

    it('password-authentication on, sshd enable', () => {
        assertconv([
            'sshd password-authentication on',
            'sshd enable',
        ], [
                'sshd.password-authentication: enable',
                'sshd.service: enable',
            ]);
    });

    it('password-authentication off, sshd enable', () => {
        assertconv([
            'sshd password-authentication off',
            'sshd enable',
        ], [
                'sshd.password-authentication: disable',
                'sshd.service: enable',
            ]);
    });

    it('password-authentication system-default, sshd disable', () => {
        assertconv([
            'sshd disable',
        ], [
                'sshd.password-authentication: enable',
                'sshd.service: disable',
            ]);
    });

    it('password-authentication on, sshd disable', () => {
        assertconv([
            'sshd password-authentication on',
            'sshd disable',
        ], [
                'sshd.password-authentication: enable',
                'sshd.service: disable',
            ]);
    });

    it('password-authentication off, sshd disable', () => {
        assertconv([
            'sshd password-authentication off',
            'sshd disable',
        ], [
                'sshd.password-authentication: disable',
                'sshd.service: disable',
            ]);
    });

    it('rsa host key', () => {
        const key = "46,2d2d2d2d2d424547494e2d2d2d2d2d0a2d2d2d2d2d454e44205253412050524956415445204b45592d2d2d2d2d0a"
        assertconv([
            `sshd hostkey rsa ${key}`,
        ], [
                'sshd.hostkey: "-----BEGIN-----\\\\n-----END RSA PRIVATE KEY-----\\\\n"',
            ]);
    });
});

describe('syslog', () => {
    it('syslog remote-server', () => {
        assertconv([
            'syslog remote on',
            'syslog remote-server add LOG1 address 192.168.0.1 log-level info',
            'syslog remote-server add LOG2 address 192.168.0.2 log-level warning',
        ], [
            'syslog.remote.server.0.ipv4.address: 192.168.0.1',
            'syslog.remote.server.0.log-level: info',
            'syslog.remote.server.1.ipv4.address: 192.168.0.2',
            'syslog.remote.server.1.log-level: warning',
        ]);
    });

    it('all parameters', () => {
        assertconv([
            'syslog remote on',
            'syslog remote-server add LOG address 10.0.0.1 port 514 hostname loghost facility local3 sequence-number on alternate-timestamp on log-level debug src 192.168.0.1',
        ], [
                'syslog.remote.server.0.ipv4.address: 10.0.0.1',
                'syslog.remote.server.0.port: 514',
                'syslog.remote.server.0.hostname: loghost',
                'syslog.remote.server.0.facility: local3',
                'syslog.remote.server.0.sequence-number: enable',
                'syslog.remote.server.0.alternate-timestamp: enable',
                'syslog.remote.server.0.log-level: debug',
                'syslog.remote.server.0.source.ipv4.address: 192.168.0.1',
            ]);
    });

    it('function conversion', () => {
        assertconv([
            'syslog memory-block application-gateway 8'
        ], [
                'syslog.memory-block.100.function: appgw',
                'syslog.memory-block.100.size: 8'
            ]);
    });
});

describe('timezone', () => {
    it('timezone Japan', () => {
        assertconv([
            'timezone "Japan"'
        ], [
            'option.timezone: JST'
        ]);
    });
});

describe('vrrp', () => {
    it('minimal', () => {
        assertconv([
            'vrrp lan0 add vrid 1 address 172.16.0.112/32',
        ], [
            'vrrp.vrouter.100.version: 2',
            'vrrp.vrouter.100.interface: ge1',
            'vrrp.vrouter.100.vrid: 1',
            'vrrp.vrouter.100.address: 172.16.0.112',
        ]);
    });

    it('all parameters', () => {
        assertconv(`
            vrrp watch-group add WG interface pppoe0 keepalive 192.168.0.2 route-up 192.168.4.0/24
            vrrp lan0 add vrid 1 address 192.168.0.1/32 priority 123 interval 12 watch WG preempt on virtual-mac on delay 234 alive-detect 2 dead-detect 3
            ---
            vrrp.vrouter.100.version: 2
            vrrp.vrouter.100.interface: ge1
            vrrp.vrouter.100.vrid: 1
            vrrp.vrouter.100.address: 192.168.0.1
            vrrp.vrouter.100.priority: 123
            vrrp.vrouter.100.interval: 12
            vrrp.vrouter.100.delay: 234
            vrrp.vrouter.100.watch.interface: pppoe0
            vrrp.vrouter.100.watch.keepalive: 192.168.0.2
            vrrp.vrouter.100.watch.alive-detect: 2
            vrrp.vrouter.100.watch.dead-detect: 3
            vrrp.vrouter.100.watch.route-up: 192.168.4.0/24
        `)
    });

    it('preempt off', () => {
        assertconv(`
            vrrp lan0 add vrid 1 address 192.168.0.1/32 preempt off
            ---
            vrrp.vrouter.100.version: 2
            vrrp.vrouter.100.address: 192.168.0.1
            vrrp.vrouter.100.interface: ge1
            vrrp.vrouter.100.vrid: 1
            vrrp.vrouter.100.preempt: disable
        `)
    });

    it('"preempt on" should be suppressed', () => {
        assertconv(`
            vrrp lan0 add vrid 1 address 192.168.0.1/32 preempt on
            ---
            vrrp.vrouter.100.version: 2
            vrrp.vrouter.100.address: 192.168.0.1
            vrrp.vrouter.100.interface: ge1
            vrrp.vrouter.100.vrid: 1
        `)
    });
});

describe('vrrp3', () => {
    it('vrrp version 3', () => {
        assertconv([
            'vrrp3 add FOO interface lan0 vrid 3 address 172.16.0.112 priority 100',
        ], [
                'vrrp.vrouter.100.version: 3',
                'vrrp.vrouter.100.interface: ge1',
                'vrrp.vrouter.100.vrid: 3',
                'vrrp.vrouter.100.address: 172.16.0.112',
                'vrrp.vrouter.100.priority: 100',
            ]);
    });

    it('all parameters', () => {
        assertconv(`
            vrrp3 watch-group add WG interface pppoe0 keepalive 2001:db8::1 alive-detect 2 dead-detect 3 route-up 2001:db8::/64
            vrrp3 add FOO interface lan0 vrid 1 address fe80::112 priority 123 interval 12 preempt on watch WG preempt on delay 234
            ---
            vrrp.vrouter.100.version: 3
            vrrp.vrouter.100.interface: ge1
            vrrp.vrouter.100.vrid: 1
            vrrp.vrouter.100.address: fe80::112
            vrrp.vrouter.100.priority: 123
            vrrp.vrouter.100.interval: 12
            vrrp.vrouter.100.delay: 234
            vrrp.vrouter.100.watch.interface: pppoe0
            vrrp.vrouter.100.watch.keepalive: 2001:db8::1
            vrrp.vrouter.100.watch.alive-detect: 2
            vrrp.vrouter.100.watch.dead-detect: 3
            vrrp.vrouter.100.watch.route-up: 2001:db8::/64
        `)
    });

    it('preempt off', () => {
        assertconv(`
            vrrp3 add FOO interface lan0 vrid 1 address 192.168.0.1 preempt off
            ---
            vrrp.vrouter.100.version: 3
            vrrp.vrouter.100.address: 192.168.0.1
            vrrp.vrouter.100.interface: ge1
            vrrp.vrouter.100.vrid: 1
            vrrp.vrouter.100.preempt: disable
        `)
    });

    it('"preempt on" should be suppressed', () => {
        assertconv(`
            vrrp3 add FOO interface lan0 vrid 1 address 192.168.0.1 preempt on
            ---
            vrrp.vrouter.100.version: 3
            vrrp.vrouter.100.address: 192.168.0.1
            vrrp.vrouter.100.interface: ge1
            vrrp.vrouter.100.vrid: 1
        `)
    });
});

describe('vendor', () => {
    it('is deprecated', () => {
        assertconv('vendor IIJ', '');
    });
});

describe('seil6', () => {
    it('can be a target device', () => {
        const c = new s2r.Converter('hostname foo\n', 'w1');
        assert.strictEqual(c.recipe_config, 'hostname: foo\n');
    });

    it('does not support "option statistics access"', () => {
        const c = new s2r.Converter('option statistics access on', 'w1');
        const e = c.conversions[0].errors[0]
        assert.strictEqual(e.type, 'notsupported');
    });
});
