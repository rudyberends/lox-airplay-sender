import crypto from 'crypto';
import fs from 'fs';
import bplistCreator from 'bplist-creator';
import bplistParser from 'bplist-parser';
import SRP from './srp';
import ATVAuthenticator from './atvAuthenticator';
import httpClientFactory from '../utils/http';

// ...
// Configuration.
const loadConfig = (configFilePath: string): Record<string, unknown> | null =>
  !fs.existsSync(configFilePath) ? null : JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
const saveConfig = (configFilePath: string, config: Record<string, unknown>): void =>
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, '\t'));

// ...

class ATV {
    addr: string;
    port: number;
    httpClient: ReturnType<typeof httpClientFactory>;
    auth_secret: string | null;

    constructor(addr: string, port?: number) {
        this.addr = addr;
        this.port = port || 7000;

        this.httpClient = httpClientFactory();
        this.auth_secret = null;
    }

    // ...

    auth(configFilePath: string, authenticator: () => Promise<string>) {
        async function auth(owner: ATV) {
            await owner.httpClient.connect(owner.addr, owner.port);

            let conf = loadConfig(configFilePath);
            const authSecret = conf && typeof conf['auth_secret'] === 'string' ? (conf['auth_secret'] as string) : null;
            if (!authSecret) {
                // a pairing does not exist and must be performed.
                
                // ...
                // SRP parameters. 
                const srp = new SRP(2048);

                const I = '366B4165DD64AD3A';
                let P: string;
                let s: string;
                let B: string;
                let a: string;
                let A: string;
                let M1: string;
                
                await owner.httpClient.request('POST', '/pair-pin-start')
                    .then(() => authenticator())
                    .then(pin => {
                        P = pin;

                        return owner.httpClient.request(
                            'POST',
                            '/pair-setup-pin', 
                            { 
                                'Content-Type': 'application/x-apple-binary-plist' 
                            }, 
                            bplistCreator({ 
                                user: '366B4165DD64AD3A',
                                method: 'pin'
                            })
                        )
                    })
                    .then((res: any) => {
                        const { pk, salt } = bplistParser.parseBuffer(res.body)[0];
                        
                        s = salt.toString('hex');
                        B = pk.toString('hex');
            
                        // SRP: Generate random auth_secret, 'a'; if pairing is successful, it'll be utilized in 
                        // subsequent session authentication(s).
                        a = crypto.randomBytes(32).toString('hex');
            
                        // SRP: Compute A and M1. 
                        A   = srp.A(a);
                        M1  = srp.M1(I, P, s, a, B);

                        return owner.httpClient.request(
                            'POST',
                            '/pair-setup-pin',
                            {
                                'Content-Type': 'application/x-apple-binary-plist'
                            },
                            bplistCreator({
                                pk: Buffer.from(A, 'hex'),
                                proof: Buffer.from(M1, 'hex')
                            })
                        );
                    })
                    .then((): Promise<any> => {
                        // confirm the auth secret (a).
                        const { epk, authTag } = ATVAuthenticator.confirm(a, srp.K(I, P, s, a, B));
            
                        // complete pair-setup-pin by registering the auth secret with the target device.
                        return owner.httpClient.request(
                            'POST',
                            '/pair-setup-pin',
                            {
                                'Content-Type': 'application/x-apple-binary-plist'
                            },
                            bplistCreator({
                                epk: Buffer.from(epk, 'hex'),
                                authTag: Buffer.from(authTag, 'hex')
                            })
                        );
                    })
                    .then(() => {
                        // save the auth secret for subsequent session authentication(s).
                        if (!conf) {
                            conf = {};
                        }
                        conf['auth_secret'] = a;
                        saveConfig(configFilePath, conf);  
                    });
            }

            // ...
            // Authenticate session with the target device using existing pairing information.
            const verifier = ATVAuthenticator.verifier((conf?.['auth_secret'] as string) ?? '');

            return owner.httpClient.request(
                'POST',
                '/pair-verify',
                {
                    'Content-Type': 'application/octet-stream'
                },
                verifier.verifierBody
            )
            .then((res: any) => {
                const atv_pub   = res.body.slice(0, 32).toString('hex');
                const atv_data  = res.body.slice(32).toString('hex'); 
        
                const shared    = ATVAuthenticator.shared(verifier.v_pri, atv_pub);
                const signed    = ATVAuthenticator.signed((conf?.['auth_secret'] as string) ?? '', verifier.v_pub, atv_pub);
                const signature = Buffer.from(
                    Buffer.from([0x00, 0x00, 0x00, 0x00]).toString('hex') + 
                    ATVAuthenticator.signature(shared, atv_data, signed),
                    'hex'
                );

                return owner.httpClient.request(
                    'POST',
                    '/pair-verify',
                    {
                        'Content-Type': 'application/octet-stream'
                    },
                    signature
                );
            });
        }

        return auth(this);
    }

    authSecret(): string | null {
        return this.auth_secret;
    }

    authSimple(authenticator: () => Promise<string>) {
        async function auth(owner: ATV) {
            await owner.httpClient.connect(owner.addr, owner.port);

            const conf = null;
            if (!conf || !conf['auth_secret']) {
                // a pairing does not exist and must be performed.
                
                // ...
                // SRP parameters. 
                const srp = new SRP(2048);

                const I = '366B4165DD64AD3A';
                let P: string;
                let s: string;
                let B: string;
                let a: string;
                let A: string;
                let M1: string;
                
                await owner.httpClient.request('POST', '/pair-pin-start')
                    .then(() => authenticator())
                    .then(pin => {
                        P = pin;

                        return owner.httpClient.request(
                            'POST',
                            '/pair-setup-pin', 
                            { 
                                'Content-Type': 'application/x-apple-binary-plist' 
                            }, 
                            bplistCreator({ 
                                user: '366B4165DD64AD3A',
                                method: 'pin'
                            })
                        )
                    })
                    .then((res: any) => {
                        const { pk, salt } = bplistParser.parseBuffer(res.body)[0];
                        
                        s = salt.toString('hex');
                        B = pk.toString('hex');
            
                        // SRP: Generate random auth_secret, 'a'; if pairing is successful, it'll be utilized in 
                        // subsequent session authentication(s).
                        a = crypto.randomBytes(32).toString('hex');
            
                        // SRP: Compute A and M1. 
                        A   = srp.A(a);
                        M1  = srp.M1(I, P, s, a, B);

                        return owner.httpClient.request(
                            'POST',
                            '/pair-setup-pin',
                            {
                                'Content-Type': 'application/x-apple-binary-plist'
                            },
                            bplistCreator({
                                pk: Buffer.from(A, 'hex'),
                                proof: Buffer.from(M1, 'hex')
                            })
                        );
                    }).then((): Promise<any> => {
                        // confirm the auth secret (a).
                        const { epk, authTag } = ATVAuthenticator.confirm(a, srp.K(I, P, s, a, B));
            
                        // complete pair-setup-pin by registering the auth secret with the target device.
                        return owner.httpClient.request(
                            'POST',
                            '/pair-setup-pin',
                            {
                                'Content-Type': 'application/x-apple-binary-plist'
                            },
                            bplistCreator({
                                epk: Buffer.from(epk, 'hex'),
                                authTag: Buffer.from(authTag, 'hex')
                            })
                        );
                    })
                    .then(() => {
                        // save the auth secret for subsequent session authentication(s).
                        owner.auth_secret = a;
                    });
            }
        }
        return auth(this);
    }

    verifySimple(secret: string) {
        // ...
        // Authenticate session with the target device using existing pairing information.
        const verifier = ATVAuthenticator.verifier(secret);

        return this.httpClient.request(
            'POST',
            '/pair-verify',
            {
                'Content-Type': 'application/octet-stream',
            },
            verifier.verifierBody
        )
        .then((res: any) => {
            const atv_pub = res.body.slice(0, 32).toString('hex');
            const atv_data = res.body.slice(32).toString('hex');

            const shared = ATVAuthenticator.shared(verifier.v_pri, atv_pub);
            const signed = ATVAuthenticator.signed(secret, verifier.v_pub, atv_pub);
            const signature = Buffer.from(
                Buffer.from([0x00, 0x00, 0x00, 0x00]).toString('hex') +
                ATVAuthenticator.signature(shared, atv_data, signed),
                'hex'
            );

            return this.httpClient.request(
                'POST',
                '/pair-verify',
                {
                    'Content-Type': 'application/octet-stream',
                },
                signature
            );
        });
    }

    play(videoUrl: string) {
        return this.httpClient.request(
            'POST',
            '/play',
            {
                'Content-Type': 'application/x-apple-binary-plist'
            },
            bplistCreator({
                'Content-Location': videoUrl,
                'Start-Location': 0
            })
        );
    }

    stop() {
        return this.httpClient.request('POST', '/stop');
    }

    close() {
        this.httpClient.close();
    }
}

// ...

export default ATV;
