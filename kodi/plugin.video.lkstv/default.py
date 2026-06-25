# -*- coding: utf-8 -*-
import sys
import json
import xbmc
import xbmcgui
import xbmcplugin
import xbmcaddon

try:
    from urllib.parse import urlencode, parse_qsl, quote_plus
    import urllib.request as urllib2
except ImportError:
    from urllib import urlencode, quote_plus
    import urllib2

ADDON = xbmcaddon.Addon()
HANDLE = int(sys.argv[1])
BASE_URL = sys.argv[0]

def get_api_base():
    return ADDON.getSetting('api_base').rstrip('/')

def api_get(path, params=None):
    url = get_api_base() + path
    if params:
        url += '?' + urlencode(params)
    req = urllib2.Request(url)
    req.add_header('User-Agent', 'Kodi/LKS-TV-Addon')
    response = urllib2.urlopen(req, timeout=20)
    return json.loads(response.read().decode('utf-8'))

def build_url(**kwargs):
    return BASE_URL + '?' + urlencode(kwargs)

def root_menu():
    items = [
        ('Films - Tendances',    'movie', 'trending'),
        ('Films - Populaires',   'movie', 'popular'),
        ('Films - Top Rated',    'movie', 'top_rated'),
        ('Séries - Tendances',   'tv',    'trending'),
        ('Séries - Populaires',  'tv',    'popular'),
        ('Séries - Top Rated',   'tv',    'top_rated'),
    ]
    for label, media_type, category in items:
        li = xbmcgui.ListItem(label)
        li.setProperty('IsPlayable', 'false')
        url = build_url(action='catalog', type=media_type, category=category, page=1)
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)
    xbmcplugin.endOfDirectory(HANDLE)

def show_catalog(media_type, category, page):
    page = int(page)
    try:
        data = api_get('/kodi/catalog', {'type': media_type, 'category': category, 'page': page})
    except Exception as e:
        xbmcgui.Dialog().notification('LKS TV', 'Erreur chargement: ' + str(e), xbmcgui.NOTIFICATION_ERROR)
        xbmcplugin.endOfDirectory(HANDLE)
        return

    for item in data.get('items', []):
        tmdb_id = item.get('tmdb_id')
        title = item.get('title', '')
        year = item.get('year', '')
        poster = item.get('poster', '')
        fanart = item.get('fanart', '')
        overview = item.get('overview', '')
        rating = item.get('rating', 0)

        label = u'{} ({})'.format(title, year) if year else title
        li = xbmcgui.ListItem(label)

        info = {
            'title': title,
            'year': int(year) if year and year.isdigit() else 0,
            'plot': overview,
            'rating': float(rating),
            'mediatype': 'movie' if media_type == 'movie' else 'tvshow',
        }
        li.setInfo('video', info)
        li.setArt({'poster': poster, 'fanart': fanart, 'thumb': poster})

        if media_type == 'movie':
            li.setProperty('IsPlayable', 'true')
            url = build_url(action='play_movie', tmdb_id=tmdb_id)
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)
        else:
            li.setProperty('IsPlayable', 'false')
            url = build_url(action='seasons', tmdb_id=tmdb_id)
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)

    total_pages = data.get('total_pages', 1)
    if page < total_pages:
        li_next = xbmcgui.ListItem(u'Page suivante >')
        li_next.setProperty('IsPlayable', 'false')
        url = build_url(action='catalog', type=media_type, category=category, page=page + 1)
        xbmcplugin.addDirectoryItem(HANDLE, url, li_next, isFolder=True)

    xbmcplugin.setContent(HANDLE, 'movies' if media_type == 'movie' else 'tvshows')
    xbmcplugin.endOfDirectory(HANDLE)

def show_seasons(tmdb_id):
    try:
        data = api_get('/kodi/seasons/{}'.format(tmdb_id))
    except Exception as e:
        xbmcgui.Dialog().notification('LKS TV', 'Erreur saisons: ' + str(e), xbmcgui.NOTIFICATION_ERROR)
        xbmcplugin.endOfDirectory(HANDLE)
        return

    show_title = data.get('show_title', '')
    for season in data.get('seasons', []):
        s_num = season.get('season_number')
        s_name = season.get('name', u'Saison {}'.format(s_num))
        s_poster = season.get('poster', '')
        ep_count = season.get('episode_count', 0)
        overview = season.get('overview', '')

        label = u'{} ({} épisodes)'.format(s_name, ep_count)
        li = xbmcgui.ListItem(label)
        li.setInfo('video', {'title': s_name, 'plot': overview, 'mediatype': 'season', 'season': s_num, 'tvshowtitle': show_title})
        li.setArt({'poster': s_poster, 'thumb': s_poster})
        li.setProperty('IsPlayable', 'false')

        url = build_url(action='episodes', tmdb_id=tmdb_id, season=s_num)
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)

    xbmcplugin.setContent(HANDLE, 'seasons')
    xbmcplugin.endOfDirectory(HANDLE)

def show_episodes(tmdb_id, season):
    try:
        data = api_get('/kodi/episodes/{}/{}'.format(tmdb_id, season))
    except Exception as e:
        xbmcgui.Dialog().notification('LKS TV', 'Erreur épisodes: ' + str(e), xbmcgui.NOTIFICATION_ERROR)
        xbmcplugin.endOfDirectory(HANDLE)
        return

    for ep in data.get('episodes', []):
        ep_num = ep.get('episode_number')
        title = ep.get('title', u'Épisode {}'.format(ep_num))
        overview = ep.get('overview', '')
        thumb = ep.get('thumbnail', '')
        rating = ep.get('rating', 0)

        label = u'S{}E{} - {}'.format(str(season).zfill(2), str(ep_num).zfill(2), title)
        li = xbmcgui.ListItem(label)
        li.setInfo('video', {
            'title': title,
            'plot': overview,
            'rating': float(rating),
            'episode': ep_num,
            'season': int(season),
            'mediatype': 'episode',
        })
        if thumb:
            li.setArt({'thumb': thumb})
        li.setProperty('IsPlayable', 'true')

        url = build_url(action='play_tv', tmdb_id=tmdb_id, season=season, episode=ep_num)
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)

    xbmcplugin.setContent(HANDLE, 'episodes')
    xbmcplugin.endOfDirectory(HANDLE)

def play_stream(params):
    xbmcgui.Dialog().notification('LKS TV', 'Recherche du stream...', xbmcgui.NOTIFICATION_INFO, 3000)
    try:
        data = api_get('/kodi/stream', params)
    except Exception as e:
        xbmcgui.Dialog().notification('LKS TV', 'Erreur stream: ' + str(e), xbmcgui.NOTIFICATION_ERROR)
        return

    streams = data.get('streams', [])
    if not streams:
        xbmcgui.Dialog().notification('LKS TV', 'Aucun stream disponible', xbmcgui.NOTIFICATION_WARNING)
        return

    if len(streams) == 1:
        stream = streams[0]
    else:
        labels = [s.get('label', 'Stream {}'.format(i+1)) for i, s in enumerate(streams)]
        idx = xbmcgui.Dialog().select('Choisir une qualité', labels)
        if idx < 0:
            return
        stream = streams[idx]

    url = stream.get('url', '')
    fmt = stream.get('format', 'hls')
    li = xbmcgui.ListItem(path=url)

    if fmt == 'hls' or url.endswith('.m3u8'):
        li.setMimeType('application/x-mpegURL')
        li.setContentLookup(False)
        li.setProperty('inputstream', 'inputstream.adaptive')
        li.setProperty('inputstream.adaptive.manifest_type', 'hls')
    elif url.endswith('.mpd'):
        li.setMimeType('application/dash+xml')
        li.setContentLookup(False)
        li.setProperty('inputstream', 'inputstream.adaptive')
        li.setProperty('inputstream.adaptive.manifest_type', 'mpd')

    xbmcplugin.setResolvedUrl(HANDLE, True, li)

def router():
    args = dict(parse_qsl(sys.argv[2].lstrip('?')))
    action = args.get('action')

    if not action:
        root_menu()
    elif action == 'catalog':
        show_catalog(args.get('type', 'movie'), args.get('category', 'trending'), args.get('page', 1))
    elif action == 'seasons':
        show_seasons(args.get('tmdb_id'))
    elif action == 'episodes':
        show_episodes(args.get('tmdb_id'), args.get('season', 1))
    elif action == 'play_movie':
        play_stream({'type': 'movie', 'tmdb_id': args.get('tmdb_id')})
    elif action == 'play_tv':
        play_stream({'type': 'tv', 'tmdb_id': args.get('tmdb_id'), 'season': args.get('season'), 'episode': args.get('episode')})

if __name__ == '__main__':
    router()
