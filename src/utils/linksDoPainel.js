function criarLinksDoPainel({ aba, filtros, ordenacao, supervisor }) {
    const atual = ordenacao || { campo: null, direcao: 'asc' };
    const url = (params) => '/professor/dashboard?' + params.toString();

    const base = () => {
        const params = new URLSearchParams({ f: '1', aba });
        if (filtros.q) params.set('q', filtros.q);
        if (supervisor) {
            (filtros.situacao || []).forEach((s) => params.append('situacao', s));
        } else {
            filtros.status.forEach((s) => params.append('status', s));
            if (filtros.arquivados) params.set('arquivados', '1');
        }
        if (atual.campo) {
            params.set('ordenar', atual.campo);
            params.set('dir', atual.direcao);
        }
        return params;
    };

    return {
        pagina(p) {
            const params = base();
            params.set('pagina', p);
            return url(params);
        },
        ordenar(campo) {
            const params = base();
            params.set('ordenar', campo);
            params.set('dir', atual.campo === campo && atual.direcao === 'asc' ? 'desc' : 'asc');
            params.set('pagina', '1');
            return url(params);
        },
        estado(campo) {
            if (atual.campo !== campo) return 'none';
            return atual.direcao === 'asc' ? 'ascending' : 'descending';
        },
        icone(campo) {
            if (atual.campo !== campo) return '↕';
            return atual.direcao === 'asc' ? '↑' : '↓';
        },
    };
}

module.exports = { criarLinksDoPainel };
