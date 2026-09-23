import type { AppContext } from '../context';

/**
 * Cloud commands (menus, the status bar's server menu, the command line).
 * Anything that needs an account opens the sign-in first and goes on after it.
 */
export interface CloudHooks {
  signIn(then?: () => void): void;
  projects(mode: 'open' | 'upload'): void;
  conflicts(): void;
}

export function registerCloudCommands(ctx: AppContext, hooks: CloudHooks): void {
  const cloud = ctx.cloud;
  const C = 'Bulut';
  const signedIn = () => cloud.auth.value === 'signedIn';
  const reachable = () => ctx.server.state.value === 'online';
  const needAccount = (next: () => void) => () => (signedIn() ? next() : hooks.signIn(next));
  const watch = [cloud.auth, ctx.server.state];
  ctx.commands.registerAll([
    {
      id: 'cloud.signIn',
      title: 'Buluta giriş…',
      category: C,
      description: 'KentOS sunucusunda hesabınızla oturum açar (yerel hesap ya da kurumunuzun OpenID girişi).',
      aliases: ['GIRIS', 'LOGIN'],
      run: () => hooks.signIn(),
      isEnabled: () => !signedIn() && reachable(),
      watch,
    },
    {
      id: 'cloud.signOut',
      title: 'Bulut oturumunu kapat',
      category: C,
      description: 'Oturumu kapatır. Açık bulut projesinin gönderilemeyen değişiklikleri bu cihazda saklanır.',
      aliases: ['CIKIS', 'LOGOUT'],
      run: () =>
        void cloud.signOut().then(
          () => ctx.log.info('Bulut oturumu kapatıldı.'),
          (e: Error) => ctx.log.error(`Oturum kapatılamadı: ${e.message}`),
        ),
      isEnabled: () => signedIn(),
      watch,
    },
    {
      id: 'cloud.open',
      title: 'Bulut projesi aç…',
      category: C,
      icon: 'fileOpen',
      description: 'Kurumunuzun bulut projelerinden birini açar. Açık projedeki değişiklikler kendiliğinden kaydedilir.',
      aliases: ['BULUTAC', 'CLOUDOPEN'],
      run: needAccount(() => hooks.projects('open')),
      isEnabled: () => reachable(),
      watch,
    },
    {
      id: 'cloud.upload',
      title: 'Buluta yükle…',
      category: C,
      description: 'Açık çizimi kurumunuzda yeni bir bulut projesi yapar; sonra her değişiklik kendiliğinden kaydedilir.',
      aliases: ['BULUTAYUKLE', 'UPLOAD'],
      run: needAccount(() => hooks.projects('upload')),
      isEnabled: () => reachable(),
      watch,
    },
    {
      id: 'cloud.conflicts',
      title: 'Kayıt çakışmalarını çöz…',
      category: C,
      description: 'Başkasının daha önce kaydettiği nesneler için sunucudakini alır ya da sizinkini kaydeder.',
      run: () => hooks.conflicts(),
      isEnabled: () => !!cloud.sync.value?.conflicts.value.length,
      watch: [cloud.sync],
    },
  ]);
}
