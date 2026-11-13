// Proteção contra CSRF pela origem da requisição.
//
// O cookie de sessão é SameSite=Lax, o que barra envios vindos de outros
// sites, mas não de outro subdomínio do mesmo domínio (que conta como
// "same-site"). Por isso toda requisição que altera estado precisa vir de uma
// página da própria aplicação: conferimos Sec-Fetch-Site e, quando o navegador
// não o envia (HTTP fora de localhost), o Origin ou o Referer.

const METODOS_SEGUROS = ['GET', 'HEAD', 'OPTIONS'];

function hostDe(valor) {
    try {
        return new URL(valor).host.toLowerCase();
    } catch {
        return null;
    }
}

// O host pedido e, atrás de proxy, o host público configurado em APP_URL.
function hostsDaAplicacao(req) {
    const hosts = new Set();
    const host = req.get('host');
    if (host) hosts.add(host.toLowerCase());
    const publico = hostDe(process.env.APP_URL || '');
    if (publico) hosts.add(publico);
    return hosts;
}

function veioDaPropriaAplicacao(req) {
    const site = req.get('sec-fetch-site');
    if (site) return site === 'same-origin';

    const origem = req.get('origin') || req.get('referer');
    const host = origem ? hostDe(origem) : null;
    return Boolean(host) && hostsDaAplicacao(req).has(host);
}

function verificarOrigem(req, res, next) {
    if (METODOS_SEGUROS.includes(req.method)) {
        // /logout é um link (GET): só recusa quando o navegador diz que o
        // clique veio de outro site ou subdomínio
        const site = req.get('sec-fetch-site');
        if (req.path === '/logout' && (site === 'cross-site' || site === 'same-site')) {
            return res.redirect('/');
        }
        return next();
    }
    if (veioDaPropriaAplicacao(req)) return next();
    return res.status(403).send('Requisição recusada: ela não partiu de uma página desta aplicação. Volte, recarregue a página e tente novamente.');
}

module.exports = { verificarOrigem };
