<?php
/**
 * Plugin Name: TNG Blog Connect
 * Description: Conecta este WordPress ao TNG Blog com 1 clique (sem senha de aplicativo): gera um
 *              token próprio, autentica a API por esse token e expõe os campos de SEO do RankMath.
 * Version: 2.0.0
 * Author: NexIA Lab
 * Requires at least: 5.6
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit; // acesso direto bloqueado
}

define('TNG_BLOG_VERSION', '2.0.0');
define('TNG_BLOG_TOKEN_OPTION', 'tng_blog_connect_token');
// Endereço do app TNG Blog rodando na máquina do operador (mesma máquina, navegador local).
define('TNG_BLOG_APP_URL', 'http://localhost:8000/api/conectar');

/* =========================================================================
 * 1. Token de conexão (gerado uma vez, guardado nas opções do site)
 * ========================================================================= */
function tng_blog_get_token() {
    $token = get_option(TNG_BLOG_TOKEN_OPTION);
    if (empty($token)) {
        $token = wp_generate_password(48, false, false);
        update_option(TNG_BLOG_TOKEN_OPTION, $token, false);
    }
    return $token;
}

register_activation_hook(__FILE__, 'tng_blog_get_token');

/* =========================================================================
 * 2. Autenticação por token (substitui a Senha de Aplicativo)
 *    Se a chamada trouxer o header X-TNG-Blog-Token válido, autentica como
 *    administrador — assim os endpoints padrão do WP REST funcionam.
 * ========================================================================= */
add_filter('determine_current_user', 'tng_blog_auth_by_token', 99);
function tng_blog_auth_by_token($user_id) {
    if (!empty($user_id)) {
        return $user_id; // já autenticado por cookie/senha de aplicativo
    }
    $enviado = isset($_SERVER['HTTP_X_TNG_BLOG_TOKEN']) ? trim($_SERVER['HTTP_X_TNG_BLOG_TOKEN']) : '';
    if ($enviado === '') {
        return $user_id;
    }
    $token = get_option(TNG_BLOG_TOKEN_OPTION);
    if ($token && hash_equals((string) $token, $enviado)) {
        $admin = get_users(array('role' => 'administrator', 'number' => 1, 'fields' => 'ID'));
        if (!empty($admin)) {
            return (int) $admin[0];
        }
    }
    return $user_id;
}

/* =========================================================================
 * 3. Menu + página de conexão (botão de 1 clique e modo manual)
 * ========================================================================= */
add_action('admin_menu', function () {
    add_menu_page('TNG Blog', 'TNG Blog', 'manage_options', 'tng-blog',
        'tng_blog_render_admin_page', 'dashicons-edit-page', 80);
});

function tng_blog_render_admin_page() {
    if (!current_user_can('manage_options')) {
        return;
    }

    $erro = null;
    $nova_senha = null;

    // Modo manual (fallback): gerar Application Password.
    if (isset($_POST['tng_blog_connect']) && check_admin_referer('tng_blog_connect_action')) {
        if (!class_exists('WP_Application_Passwords')) {
            $erro = 'Este WordPress não suporta Senhas de Aplicativo (requer 5.6+ e HTTPS).';
        } else {
            $criada = WP_Application_Passwords::create_new_application_password(
                get_current_user_id(), array('name' => 'TNG Blog ' . gmdate('Y-m-d H:i'))
            );
            if (is_wp_error($criada)) {
                $erro = $criada->get_error_message();
            } else {
                $nova_senha = $criada[0];
            }
        }
    }

    $usuario  = wp_get_current_user();
    $site_url = home_url();
    $nome     = get_bloginfo('name');
    $token    = tng_blog_get_token();
    $rankmath = tng_blog_rankmath_ativo();
    ?>
    <div class="wrap">
        <h1>TNG Blog — Conexão</h1>
        <p>Conecte este site ao TNG Blog para publicar artigos automaticamente.</p>

        <?php if ($erro): ?>
            <div class="notice notice-error"><p><?php echo esc_html($erro); ?></p></div>
        <?php endif; ?>

        <table class="widefat" style="max-width:680px;margin-bottom:20px">
            <tbody>
                <tr><td><strong>Site</strong></td><td><code><?php echo esc_html($nome); ?></code></td></tr>
                <tr><td><strong>Endereço</strong></td><td><code><?php echo esc_html($site_url); ?></code></td></tr>
                <tr><td><strong>RankMath</strong></td><td><?php echo $rankmath ? '✅ instalado' : '⚠️ não detectado'; ?></td></tr>
                <tr><td><strong>Plugin TNG Blog Connect</strong></td><td>✅ versão <?php echo esc_html(TNG_BLOG_VERSION); ?></td></tr>
            </tbody>
        </table>

        <h2>Conexão automática (recomendado)</h2>
        <p>Com o <strong>TNG Blog aberto no seu computador</strong>, clique no botão abaixo: o site
           será vinculado automaticamente, sem precisar copiar nada.</p>
        <form method="post" action="<?php echo esc_url(TNG_BLOG_APP_URL); ?>" target="_blank">
            <input type="hidden" name="nome" value="<?php echo esc_attr($nome); ?>">
            <input type="hidden" name="url" value="<?php echo esc_attr($site_url); ?>">
            <input type="hidden" name="token" value="<?php echo esc_attr($token); ?>">
            <p><button type="submit" class="button button-primary button-hero">Conectar ao TNG Blog</button></p>
            <p class="description">Abre uma aba em <code>localhost:8000</code> (o app no seu PC) e confirma a conexão.</p>
        </form>

        <hr style="margin:28px 0">

        <h2>Modo manual (alternativa)</h2>
        <p class="description">Use só se a conexão automática não funcionar na sua rede.</p>
        <?php if ($nova_senha): ?>
            <div class="notice notice-success"><p><strong>Credencial gerada!</strong> Copie e cole no
                painel do TNG Blog (aparece só uma vez).</p></div>
            <table class="widefat" style="max-width:680px;margin-bottom:16px"><tbody>
                <tr><td><strong>Endereço</strong></td><td><code><?php echo esc_html($site_url); ?></code></td></tr>
                <tr><td><strong>Usuário</strong></td><td><code><?php echo esc_html($usuario->user_login); ?></code></td></tr>
                <tr><td><strong>Senha de aplicativo</strong></td><td><code style="font-size:15px"><?php echo esc_html($nova_senha); ?></code></td></tr>
            </tbody></table>
        <?php endif; ?>
        <form method="post">
            <?php wp_nonce_field('tng_blog_connect_action'); ?>
            <p><button type="submit" name="tng_blog_connect" class="button">Gerar credencial manual</button></p>
        </form>
    </div>
    <?php
}

/* =========================================================================
 * 4. Detecção do RankMath
 * ========================================================================= */
function tng_blog_rankmath_ativo() {
    return function_exists('rank_math') || defined('RANK_MATH_VERSION') || class_exists('RankMath\\Helper');
}

/* =========================================================================
 * 5. Endpoints REST próprios do TNG Blog
 * ========================================================================= */
add_action('rest_api_init', function () {
    register_rest_route('tng-blog/v1', '/status', array(
        'methods'             => 'GET',
        'callback'            => 'tng_blog_rest_status',
        'permission_callback' => function () { return current_user_can('edit_posts'); },
    ));
    register_rest_route('tng-blog/v1', '/rankmath', array(
        'methods'             => 'POST',
        'callback'            => 'tng_blog_rest_set_rankmath',
        'permission_callback' => function () { return current_user_can('edit_posts'); },
        'args'                => array('post_id' => array('required' => true, 'type' => 'integer')),
    ));
});

function tng_blog_rest_status() {
    return array(
        'plugin'   => 'tng-blog-connect',
        'version'  => TNG_BLOG_VERSION,
        'rankmath' => tng_blog_rankmath_ativo(),
        'user'     => wp_get_current_user()->user_login,
    );
}

function tng_blog_rest_set_rankmath($request) {
    $post_id = (int) $request['post_id'];
    if (!$post_id || get_post_status($post_id) === false) {
        return new WP_Error('post_invalido', 'Post não encontrado.', array('status' => 404));
    }
    $mapa = array(
        'title'         => 'rank_math_title',
        'description'   => 'rank_math_description',
        'focus_keyword' => 'rank_math_focus_keyword',
    );
    $gravados = array();
    foreach ($mapa as $param => $meta_key) {
        $valor = $request->get_param($param);
        if ($valor !== null && $valor !== '') {
            update_post_meta($post_id, $meta_key, sanitize_text_field($valor));
            $gravados[] = $meta_key;
        }
    }
    return array('ok' => true, 'post_id' => $post_id, 'gravados' => $gravados);
}
