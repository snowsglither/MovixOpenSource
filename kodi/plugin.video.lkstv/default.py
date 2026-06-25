# -*- coding: utf-8 -*-
import sys
import json
import xbmc
import xbmcgui
import xbmcplugin

from urllib.parse import urlencode, parse_qsl
import urllib.request as urllib2

HANDLE = int(sys.argv[1])
BASE_URL = sys.argv[0]
API_BASE = 'https://abraham-praise-yours-join.trycloudflare.com'

def build_url(**kwargs):
    return BASE_URL + '?' + urlencode(kwargs)

def api_get(path, params=None):
    url = API_BASE + path
    if params:
        url += '?' + urlencode(params)
    req = urllib2.Request(url)
    req.add_header('User-Agent', 'Kodi/LKS-TV')
    resp = urllib2.urlopen(req, timeout=20)
    return json.loads(resp.read().decode('utf-8'))

def root_menu():
    items = [
        ('🔍 Rechercher',         'search',  None),
        ('🔥 Films - Tendances',  'catalog_movie', 'trending'),
        ('🎬 Films - Populaires', 'catalog_movie', 'popular'),
        ('⭐ Films - Top Rated',  'catalog_movie', 'top_rated'),
        ('📺 Séries - Tendances', 'catalog_tv',    'trending'),
        ('🌟 Séries - Populaires','catalog_tv',    'popular'),
        ('🏆 Séries - Top Rated', 'catalog_tv',    'top_rated'),
    ]
    for label, action, category in items:
        li = xbmcgui.ListItem(label)
        li.setProperty('IsPlayable', 'false')
        if action == 'search':
            url = build_url(action='search')
        else:
            media_type = 'movie' if action == 'catalog_movie' else 'tv'
            url = build_url(action='catalog', type=media_type, category=category, page=1)
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)
    xbmcplugin.endOfDirectory(HANDLE)

def do_search():
    kb = xbmcgui.Dialog().input('Rechercher un film ou une série', type=xbmcgui.INPUT_ALPHANUM)
    if not kb:
        xbmcplugin.endOfDirectory(HANDLE)
        return
    try:
        data = api_get('/kodi/search', {'q': kb, 'type': 'multi'})
    except Exception as e:
        xbmcgui.Dialog().notification('LKS TV', str(e), xbmcgui.NOTIFICATION_ERROR)
        xbmcplugin.endOfDirectory(HANDLE)
        return

    for item in data.get('items', []):
        tmdb_id = item.get('tmdb_id')
        title = item.get('title', '')
        year = item.get('year', '')
        media_type = item.get('type', 'movie')
        label = '{} ({}) [{}]'.format(title, year, 'Film' if media_type == 'movie' else 'Série')
        li = xbmcgui.ListItem(label)
        li.setInfo('video', {'title': title, 'year': int(year) if year and year.isdigit() else 0, 'plot': item.get('overview', ''), 'mediatype': 'movie' if media_type == 'movie' else 'tvshow'})
        li.setArt({'poster': item.get('poster', ''), 'fanart': item.get('fanart', '')})

        if media_type == 'movie':
            li.setProperty('IsPlayable', 'true')
            url = build_url(action='play_movie', tmdb_id=tmdb_id)
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)
        else:
            li.setProperty('IsPlayable', 'false')
            url = build_url(action='seasons', tmdb_id=tmdb_id)
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)

    xbmcplugin.setContent(HANDLE, 'movies')
    xbmcplugin.endOfDirectory(HANDLE)

def show_catalog(media_type, category, page):
    try:
        data = api_get('/kodi/catalog', {'type': media_type, 'category': category, 'page': page})
    except Exception as e:
        xbmcgui.Dialog().notification('LKS TV', str(e), xbmcgui.NOTIFICATION_ERROR)
        xbmcplugin.endOfDirectory(HANDLE)
        return

    for item in data.get('items', []):
        tmdb_id = item.get('tmdb_id')
        title = item.get('title', '')
        year = item.get('year', '')
        label = '{} ({})'.format(title, year) if year else title
        li = xbmcgui.ListItem(label)
        li.setInfo('video', {'title': title, 'year': int(year) if year and year.isdigit() else 0, 'plot': item.get('overview', ''), 'mediatype': 'movie' if media_type == 'movie' else 'tvshow'})
        li.setArt({'poster': item.get('poster', ''), 'fanart': item.get('fanart', '')})

        if media_type == 'movie':
            li.setProperty('IsPlayable', 'true')
            url = build_url(action='play_movie', tmdb_id=tmdb_id)
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)
        else:
            li.setProperty('IsPlayable', 'false')
            url = build_url(action='seasons', tmdb_id=tmdb_id)
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)

    total_pages = data.get('total_pages', 1)
    if int(page) < total_pages:
        li_next = xbmcgui.ListItem('Page suivante >')
        li_next.setProperty('IsPlayable', 'false')
        url = build_url(action='catalog', type=media_type, category=category, page=int(page)+1)
        xbmcplugin.addDirectoryItem(HANDLE, url, li_next, isFolder=True)

    xbmcplugin.setContent(HANDLE, 'movies' if media_type == 'movie' else 'tvshows')
    xbmcplugin.endOfDirectory(HANDLE)

def show_seasons(tmdb_id):
    try:
        data = api_get('/kodi/seasons/{}'.format(tmdb_id))
    except Exception as e:
        xbmcgui.Dialog().notification('LKS TV', str(e), xbmcgui.NOTIFICATION_ERROR)
        xbmcplugin.endOfDirectory(HANDLE)
        return

    for s in data.get('seasons', []):
        s_num = s.get('season_number')
        label = s.get('name', 'Saison {}'.format(s_num))
        li = xbmcgui.ListItem(label)
        li.setInfo('video', {'mediatype': 'season', 'season': s_num})
        li.setArt({'poster': s.get('poster', '')})
        li.setProperty('IsPlayable', 'false')
        url = build_url(action='episodes', tmdb_id=tmdb_id, season=s_num)
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)

    xbmcplugin.setContent(HANDLE, 'seasons')
    xbmcplugin.endOfDirectory(HANDLE)

def show_episodes(tmdb_id, season):
    try:
        data = api_get('/kodi/episodes/{}/{}'.format(tmdb_id, season))
    except Exception as e:
        xbmcgui.Dialog().notification('LKS TV', str(e), xbmcgui.NOTIFICATION_ERROR)
        xbmcplugin.endOfDirectory(HANDLE)
        return

    for ep in data.get('episodes', []):
        ep_num = ep.get('episode_number')
        title = ep.get('title', 'Episode {}'.format(ep_num))
        label = 'S{}E{} - {}'.format(str(season).zfill(2), str(ep_num).zfill(2), title)
        li = xbmcgui.ListItem(label)
        li.setInfo('video', {'title': title, 'plot': ep.get('overview', ''), 'episode': ep_num, 'season': int(season), 'mediatype': 'episode'})
        li.setArt({'thumb': ep.get('thumbnail', '')})
        li.setProperty('IsPlayable', 'true')
        url = build_url(action='play_tv', tmdb_id=tmdb_id, season=season, episode=ep_num)
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)

    xbmcplugin.setContent(HANDLE, 'episodes')
    xbmcplugin.endOfDirectory(HANDLE)

def play_stream(params):
    try:
        data = api_get('/kodi/stream', params)
    except Exception as e:
        xbmcgui.Dialog().notification('LKS TV', str(e), xbmcgui.NOTIFICATION_ERROR)
        return

    streams = data.get('streams', [])
    if not streams:
        xbmcgui.Dialog().notification('LKS TV', 'Aucun stream dispo', xbmcgui.NOTIFICATION_WARNING)
        return

    stream = streams[0]
    if len(streams) > 1:
        idx = xbmcgui.Dialog().select('Qualite', [s.get('label', 'Stream') for s in streams])
        if idx >= 0:
            stream = streams[idx]

    url = stream.get('url', '')
    li = xbmcgui.ListItem(path=url)
    if '.m3u8' in url or stream.get('format') == 'hls':
        li.setMimeType('application/x-mpegURL')
        li.setContentLookup(False)
        li.setProperty('inputstream', 'inputstream.adaptive')
        li.setProperty('inputstream.adaptive.manifest_type', 'hls')
    xbmcplugin.setResolvedUrl(HANDLE, True, li)

def router():
    args = dict(parse_qsl(sys.argv[2].lstrip('?')))
    action = args.get('action')
    if not action:
        root_menu()
    elif action == 'search':
        do_search()
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
