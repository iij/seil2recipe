const s2r = require('../seil2recipe');
const assert = require('assert');

function assertconv(seil_config, recipe_config) {
    if (seil_config instanceof Array) {
        seil_config = seil_config.join('\n');
    }
    const c = new s2r.Converter(seil_config + '\n');

    const expected = (typeof recipe_config == 'string') ? [ recipe_config ] : recipe_config;
    const actual   = c.recipe_config.trim().split('\n');

    actual.sort();
    expected.sort();
    assert.deepStrictEqual(actual, expected);
}

function assert_conversions(seil_config, fun) {
    if (seil_config instanceof Array) {
        seil_config = seil_config.join('\n');
    }
    const c = new s2r.Converter(seil_config + '\n');
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
            'pppac protocol l2tp add PROTO1 accept-interface any idle-timer 123',
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
                'interface.pppac0.l2tp.idle-timer: 123',
                'interface.pppac0.l2tp.ipsec.preshared-key: SecretKey',
                'interface.pppac0.l2tp.ipsec.requirement: required',
                'interface.pppac0.l2tp.service: enable',
                'interface.pppac1.authentication.100.account-list.interval: 123',
                'interface.pppac1.authentication.100.account-list.url: http://example.jp/',
                'interface.pppac1.ipcp.pool.100.address: 192.168.128.0',
                'interface.pppac1.ipcp.pool.100.count: 256',
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
        ], [
            ""
        ]);
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
    it('is not supported', () => {
        assert_conversions('cbq class add HOGE parent default pbandwidth 100 borrow on', convs => {
            assert(convs[0].errors[0].type == 'notsupported');
        });
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
        ], [
                'dhcp6.client.100.interface: lan1',
                'dhcp6.client.service: enable',
            ]);
    });
});

describe('dialup-device', () => {
    it('is not supported', () => {
        assert_conversions('dialup-device access-point add IIJ cid 2 apn iijmobile.jp', convs => {
            assert(convs[0].errors[0].type == 'notsupported');
        });
    });
});

describe('dialup-network', () => {
    it('is not supported', () => {
        assert_conversions('dialup-network l2tp-dn0 connect-to 172.16.0.1 ipsec-preshared-key "ipsecpskey"', convs => {
            assert(convs[0].errors[0].type == 'notsupported');
        });
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

    it('query-translation is not supported', () => {
        assert_conversions('dns forwarder query-translation enable', convs => {
            assert.equal(convs[0].errors[0].type, 'notsupported');
        });
    });
});

describe('encrypted-password-long', () => {
    it('login-timer', () => {
        assertconv([
            'encrypted-password-long admin $2a$07$YDRU02fiS6Fy7sr1TcIBkuOFqA/mQaTYmgza4m5QppasE8RIUpZ/m',
        ], [
            'login.admin.encrypted-password: $2a$07$YDRU02fiS6Fy7sr1TcIBkuOFqA/mQaTYmgza4m5QppasE8RIUpZ/m',
        ]);
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
    it('application parameter is deprecated', () => {
        assert_conversions('filter add FOO interface vlan0 direction in action pass application winny', convs => {
            assert.equal(convs[0].errors[0].type, 'deprecated');
        });
    });

    it('direction in/out -> inout', () => {
        assertconv([
            'filter add FOO interface vlan0 direction in/out action pass state disable logging on enable',
        ], [
            'filter.ipv4.100.action: pass',
            'filter.ipv4.100.direction: inout',
            'filter.ipv4.100.interface: vlan0',
            'filter.ipv4.100.logging: on',
            'filter.ipv4.100.state: disable'
        ]);
    });
});

describe('floatlink', () => {
    it('ike proposal', () => {
        assertconv('floatlink ike proposal hash sha256,sha1',
            [
                'floatlink.ike.proposal.phase1.hash.100.algorithm: sha256',
                'floatlink.ike.proposal.phase1.hash.200.algorithm: sha1'
            ]);
    });

    it('ipsec proposal', () => {
        assertconv('floatlink ipsec proposal authentication-algorithm hmac-sha256,hmac-sha1',
            [
                'floatlink.ike.proposal.phase2.authentication.100.algorithm: hmac-sha256',
                'floatlink.ike.proposal.phase2.authentication.200.algorithm: hmac-sha1'
            ]);
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
    it('timers', () => {
        assertconv([
            'ike interval 40s phase1-timeout 41s phase2-timeout 42s dpd-interval 43',
        ], [
            'ike.interval: 40',
            'ike.phase1-timeout: 41s',
            'ike.phase2-timeout: 42s',
            'ike.dpd-interval: 43',
        ]);
    });
});

describe('interface', () => {
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

    it('pppoe0', () => {
        assertconv([
            'ppp add IIJ keepalive 30 ipcp enable ipcp-address on ipcp-dns on ipv6cp disable' +
            ' authentication-method auto identifier user@example.jp passphrase PASS tcp-mss 1404 tcp-mss6 1406',
            'interface pppoe0 over lan1',
            'interface pppoe0 ppp-configuration IIJ'
        ], [
                'interface.pppoe0.id: user@example.jp',
                'interface.pppoe0.ipcp: enable',
                'interface.pppoe0.ipcp.address: enable',
                'interface.pppoe0.ipcp.dns: enable',
                'interface.pppoe0.ipv4.tcp-mss: 1404',
                'interface.pppoe0.ipv6.tcp-mss: 1406',
                'interface.pppoe0.ipv6cp: disable',
                'interface.pppoe0.keepalive: 30',
                'interface.pppoe0.password: PASS',
            ]);
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
    it('ルーティングベース IPsec', () => {
        assertconv([
            'interface ipsec0 tunnel 10.0.0.1 10.0.0.2',
            'ike preshared-key add "10.0.0.2" "two"',
            'ike proposal add IKEP encryption aes128 hash sha1 authentication preshared-key dh-group modp1536 lifetime-of-time 24h',
            'ike peer add TWO address 10.0.0.2 exchange-mode main proposals IKEP my-identifier address peers-identifier address initial-contact enable tunnel-interface enable',
            'ipsec security-association proposal add SAP authentication-algorithm hmac-sha1 encryption-algorithm aes256 lifetime-of-time 8h',
            'ipsec security-association add SA tunnel-interface ipsec0 ike SAP esp enable',
        ], [
            'interface.ipsec0.ipv4.source: 10.0.0.1',
            'interface.ipsec0.ipv4.destination: 10.0.0.2',
            'interface.ipsec0.preshared-key: two',
            'interface.ipsec0.ike.initial-contact: enable',
            'interface.ipsec0.ike.proposal.phase2.authentication.100.algorithm: hmac-sha1',
            'interface.ipsec0.ike.proposal.phase2.encryption.100.algorithm: aes256',
            'interface.ipsec0.ike.proposal.phase2.lifetime-of-time: 8h',
        ]);
    });

    it('policy mode', () => {
        assertconv([
            'ipsec security-association proposal add SAP authentication-algorithm hmac-sha256,hmac-sha1 encryption-algorithm aes256,aes128,3des',
            'ipsec security-association add SA tunnel 10.0.0.1 10.0.0.2 ike SAP esp enable',
            'ipsec security-policy add A security-association SA protocol udp src 172.16.0.1/32 srcport 1234 dst 172.16.0.2/32 dstport 4321'
        ], [
            'ipsec.security-association.sa0.address-type: static',
            'ipsec.security-association.sa0.local-address: 10.0.0.1',
            'ipsec.security-association.sa0.remote-address: 10.0.0.2',
            'ipsec.security-policy.100.destination.address: 172.16.0.2/32',
            'ipsec.security-policy.100.destination.port: 4321',
            'ipsec.security-policy.100.ike.proposal.authentication.100.algorithm: hmac-sha256',
            'ipsec.security-policy.100.ike.proposal.authentication.200.algorithm: hmac-sha1',
            'ipsec.security-policy.100.ike.proposal.encryption.100.algorithm: aes256',
            'ipsec.security-policy.100.ike.proposal.encryption.200.algorithm: aes128',
            'ipsec.security-policy.100.ike.proposal.encryption.300.algorithm: 3des',
            'ipsec.security-policy.100.protocol: udp',
            'ipsec.security-policy.100.security-association: sa0',
            'ipsec.security-policy.100.source.address: 172.16.0.1/32',
            'ipsec.security-policy.100.source.port: 1234',
        ]);
    });

    it('dynamic', () => {
        assertconv([
            'ipsec security-association proposal add SAP2 authentication-algorithm hmac-sha384 encryption-algorithm aes192',
            'ipsec security-association add SA tunnel dynamic ike SAP2 ikefew esp enable',
            'ipsec security-policy add A security-association SA protocol udp src 172.16.0.1/32 srcport 1234 dst 172.16.0.2/32 dstport 4321'
        ], [
            'ipsec.security-association.sa0.address-type: dynamic',
            'ipsec.security-policy.100.destination.address: 172.16.0.2/32',
            'ipsec.security-policy.100.destination.port: 4321',
            'ipsec.security-policy.100.ike.proposal.authentication.100.algorithm: hmac-sha384',
            'ipsec.security-policy.100.ike.proposal.encryption.100.algorithm: aes192',
            'ipsec.security-policy.100.protocol: udp',
            'ipsec.security-policy.100.security-association: sa0',
            'ipsec.security-policy.100.source.address: 172.16.0.1/32',
            'ipsec.security-policy.100.source.port: 1234',
        ]);
    });

    it('L2TPv3 over IPsec', () => {
        assertconv([
            'l2tp hostname sideA',
            'l2tp router-id 10.0.0.1',
            'l2tp add B hostname sideB router-id 10.0.0.2',
            'interface l2tp0 tunnel 10.0.0.1 10.0.0.2',
            'interface l2tp0 l2tp B remote-end-id foo',
            'ike preshared-key add 10.0.0.2 foo',
            'ike proposal add IKEP encryption aes128 hash sha1 dh-group modp1536 auth preshared-key',
            'ike peer add B address 10.0.0.2 exchange-mode main proposals IKEP',
            'ipsec security-association proposal add SAP authentication-algorithm hmac-sha1 encryption-algorithm aes128',
            'ipsec security-association add SA transport 10.0.0.1 10.0.0.2 ike SAP esp enable',
            'ipsec security-policy add SP security-association SA protocol 115 src 10.0.0.1/32 dst 10.0.0.2/32',
        ], [
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
                'upnp.timeout: 1234',
                'upnp.timeout-type: arp',
            ]);
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
});

describe('option', () => {
    it('options', () => {
        assertconv([
            'option ip directed-broadcast on',
            'option ip fragment-requeueing on',
        ], [
            'option.ipv4.directed-broadcast.service: enable',
            'option.ipv4.fragment-requeueing.service: enable',
        ])

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
});

describe('route', () => {
    it('RIP', () => {
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
            'ospf.redistribute-from.rip.filter.100.match.prefix: 192.168.0.0/16-32',
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

    it('ignore redistribution if ospf is disabled', () => {
        assertconv([
            'route dynamic ospf disable',
            'route dynamic redistribute connected-to-ospf enable',
            'route dynamic redistribute static-to-ospf enable',
            'route dynamic redistribute rip-to-ospf enable',
            'route dynamic redistribute bgp-to-ospf enable',
        ], [ '' ]);
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

describe('snmp', () => {
    it('snmp basic configuration', () => {
        assertconv([
            'snmp enable',
            'snmp community HIMITSU',
            'snmp sysname SEIL/X4',
            'snmp trap enable',
            'snmp trap add 10.0.0.1',
            'snmp trap add 10.0.0.2',
        ], [
            'snmp.service: enable',
            'snmp.community: HIMITSU',
            'snmp.sysname: SEIL/X4',
            'snmp.trap.service: enable',
            'snmp.trap.host.100.address: 10.0.0.1',
            'snmp.trap.host.200.address: 10.0.0.2',
        ]);
    });
});

describe('sshd', () => {
    it('sshd enable only', () => {
        assertconv([
            'sshd enable',
        ], [
            'sshd.service: enable',
            'sshd.password-authentication: enable',
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
    it('vrrp version 2', () => {
        assertconv([
            'vrrp lan0 add vrid 1 address 172.16.0.112/32 priority 100',
        ], [
            'vrrp.vrouter.100.version: 2',
            'vrrp.vrouter.100.interface: ge1',
            'vrrp.vrouter.100.vrid: 1',
            'vrrp.vrouter.100.address: 172.16.0.112/32',
            'vrrp.vrouter.100.priority: 100',
        ]);
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
});

describe('vendor', () => {
    it('is deprecated', () => {
        assertconv('vendor IIJ', '');
    });
});
