---
# Feel free to add content and custom Front Matter to this file.
# To modify the layout, see https://jekyllrb.com/docs/themes/#overriding-theme-defaults

layout: default
---

<h1>Email Directory</h1>
   
{% assign folders = "" | split: "" %}
{% for item in site.blogs %}
  {% assign folder = item.path | split: "/" | slice: 1 | first %}
  {% unless folders contains folder %}
    {% assign folders = folders | push: folder %}
  {% endunless %}
{% endfor %}

<ul>
  {% for folder in folders %}
    <li>
      <a href="/{{ folder }}">{{ folder }}</a>
    </li>
  {% endfor %}
</ul>
